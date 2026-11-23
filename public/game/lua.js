/* Cascade Lua — a small, dependency-free Lua subset compiler.
   It runs in the browser (window.CascadeLua) and in Node (`import './lua.js'`).
   Supported: local/assignment, if/elseif/else, while, repeat, numeric and
   pairs/ipairs for, functions, return/break, tables, and the usual operators.
   Cascade objects/functions are exposed to the script: entity, api, input,
   log, game, args (Flow). Tables use JS arrays/objects; array indexes are
   adjusted to Lua's 1-based convention through __L.get/__L.set. */
(function (root) {
  'use strict';

  const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
  const LIFECYCLE = {
    on_start: 'onStart', on_update: 'onUpdate', on_fixed_update: 'fixedUpdate', on_destroy: 'destroy',
    on_collision_enter: 'collisionEnter', on_collision_exit: 'collisionExit', on_ui_click: 'uiClick',
    on_key_pressed: 'keyPressed', on_scene_load: 'sceneLoad', on_scene_unload: 'sceneUnload',
    on_animation_finished: 'animationFinished',
  };

  class LuaError extends Error {
    constructor(message, line) { super(line ? `Line ${line}: ${message}` : message); this.line = line; }
  }

  function lex(source) {
    const tokens = [];
    let i = 0;
    let line = 1;
    const push = (type, value) => tokens.push({ type, value, line });
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\n') { line += 1; i += 1; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r') { i += 1; continue; }
      if (ch === '-' && source[i + 1] === '-') {
        if (source[i + 2] === '[' && source[i + 3] === '[') {
          const end = source.indexOf(']]', i + 4);
          const chunk = end < 0 ? source.slice(i + 4) : source.slice(i + 4, end);
          line += (chunk.match(/\n/g) || []).length;
          i = end < 0 ? source.length : end + 2;
        } else {
          const end = source.indexOf('\n', i);
          i = end < 0 ? source.length : end;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        const quote = ch; let j = i + 1; let out = '';
        while (j < source.length && source[j] !== quote) {
          if (source[j] === '\\') {
            const next = source[j + 1];
            out += ({ n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'" }[next] || next);
            j += 2;
          } else { out += source[j]; j += 1; if (source[j - 1] === '\n') line += 1; }
        }
        if (j >= source.length) throw new LuaError('unterminated string', line);
        push('string', out); i = j + 1; continue;
      }
      if (ch === '[' && source[i + 1] === '[') {
        const end = source.indexOf(']]', i + 2);
        const text = end < 0 ? source.slice(i + 2) : source.slice(i + 2, end);
        line += (text.match(/\n/g) || []).length;
        push('string', text); i = end < 0 ? source.length : end + 2; continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1]))) {
        const match = /^(0x[0-9a-f]+|\d+(\.\d*)?([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/.exec(source.slice(i));
        push('number', Number(match[0])); i += match[0].length; continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i + 1;
        while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j += 1;
        const word = source.slice(i, j);
        push(KEYWORDS.has(word) ? 'kw' : 'name', word); i = j; continue;
      }
      const multi = ['...', '..', '==', '~=', '<=', '>=', '//', '::'];
      const op = multi.find((candidate) => source.startsWith(candidate, i)) || ch;
      push('op', op); i += op.length;
    }
    tokens.push({ type: 'eof', value: '<eof>', line });
    return tokens;
  }

  function parse(source) {
    const tokens = lex(source);
    let pos = 0;
    const peek = () => tokens[pos];
    const at = (value) => tokens[pos].value === value && ['op', 'kw'].includes(tokens[pos].type);
    const next = () => tokens[pos++];
    const expect = (value) => {
      if (!at(value)) throw new LuaError(`expected "${value}" but found "${peek().value}"`, peek().line);
      return next();
    };
    const accept = (value) => { if (at(value)) { next(); return true; } return false; };

    function parseBlock(...stops) {
      const body = [];
      while (peek().type !== 'eof' && !stops.some((stop) => at(stop))) body.push(parseStatement());
      return body;
    }

    function parseStatement() {
      const token = peek();
      if (at('local')) {
        next();
        if (at('function')) {
          next();
          const name = expectName();
          return { type: 'LocalFunction', name: name.value, func: parseFunctionBody(name.line) };
        }
        const names = [expectName().value];
        while (accept(',')) names.push(expectName().value);
        const values = accept('=') ? parseExprList() : [];
        return { type: 'Local', names, values, line: token.line };
      }
      if (at('function')) {
        next();
        const name = expectName();
        let target = { type: 'var', name: name.value };
        while (accept('.')) target = { type: 'member', obj: target, name: expectName().value };
        return { type: 'Function', target, func: parseFunctionBody(name.line), line: token.line };
      }
      if (at('if')) {
        next();
        const branches = [];
        const condition = parseExpression();
        expect('then');
        branches.push({ condition, body: parseBlock('elseif', 'else', 'end') });
        while (accept('elseif')) {
          const cond = parseExpression(); expect('then');
          branches.push({ condition: cond, body: parseBlock('elseif', 'else', 'end') });
        }
        const elseBody = accept('else') ? parseBlock('end') : null;
        expect('end');
        return { type: 'If', branches, elseBody };
      }
      if (at('while')) {
        next(); const condition = parseExpression(); expect('do');
        const body = parseBlock('end'); expect('end');
        return { type: 'While', condition, body };
      }
      if (at('repeat')) {
        next(); const body = parseBlock('until'); expect('until');
        return { type: 'Repeat', body, condition: parseExpression() };
      }
      if (at('for')) {
        next();
        const first = expectName().value;
        if (accept('=')) {
          const start = parseExpression(); expect(','); const stop = parseExpression();
          const step = accept(',') ? parseExpression() : null;
          expect('do'); const body = parseBlock('end'); expect('end');
          return { type: 'ForNumeric', name: first, start, stop, step, body };
        }
        const names = [first];
        while (accept(',')) names.push(expectName().value);
        expect('in'); const iter = parseExpression();
        expect('do'); const body = parseBlock('end'); expect('end');
        return { type: 'ForIn', names, iter, body };
      }
      if (at('do')) {
        next(); const body = parseBlock('end'); expect('end');
        return { type: 'Do', body };
      }
      if (at('return')) {
        next();
        const values = (peek().type === 'eof' || ['end', 'else', 'elseif', 'until'].includes(peek().value)) ? [] : parseExprList();
        return { type: 'Return', values };
      }
      if (at('break')) { next(); return { type: 'Break' }; }
      const target = parseSuffixed();
      if (at('=') || at(',')) {
        const targets = [target];
        while (accept(',')) targets.push(parseSuffixed());
        expect('=');
        return { type: 'Assign', targets, values: parseExprList(), line: token.line };
      }
      return { type: 'CallStatement', call: target, line: token.line };
    }

    function expectName() {
      if (peek().type !== 'name') throw new LuaError(`expected a name but found "${peek().value}"`, peek().line);
      return next();
    }

    function parseFunctionBody(line) {
      expect('(');
      const params = [];
      if (!at(')')) {
        params.push(expectName().value);
        while (accept(',')) params.push(expectName().value);
      }
      expect(')');
      const body = parseBlock('end');
      expect('end');
      return { params, body, line };
    }

    function parseExprList() {
      const values = [parseExpression()];
      while (accept(',')) values.push(parseExpression());
      return values;
    }

    function parseExpression() { return parseOr(); }
    function parseOr() {
      let left = parseAnd();
      while (accept('or')) left = { type: 'bin', op: 'or', left, right: parseAnd() };
      return left;
    }
    function parseAnd() {
      let left = parseCompare();
      while (accept('and')) left = { type: 'bin', op: 'and', left, right: parseCompare() };
      return left;
    }
    function parseCompare() {
      let left = parseConcat();
      while (['==', '~=', '<', '<=', '>', '>='].some((op) => at(op))) {
        const op = next().value;
        left = { type: 'bin', op, left, right: parseConcat() };
      }
      return left;
    }
    function parseConcat() {
      let left = parseAdd();
      if (accept('..')) left = { type: 'bin', op: '..', left, right: parseConcat() };
      return left;
    }
    function parseAdd() {
      let left = parseMul();
      while (at('+') || at('-')) { const op = next().value; left = { type: 'bin', op, left, right: parseMul() }; }
      return left;
    }
    function parseMul() {
      let left = parseUnary();
      while (at('*') || at('/') || at('//') || at('%')) { const op = next().value; left = { type: 'bin', op, left, right: parseUnary() }; }
      return left;
    }
    function parseUnary() {
      if (at('not') || at('-') || at('#')) { const op = next().value; return { type: 'unary', op, expr: parseUnary() }; }
      return parsePower();
    }
    function parsePower() {
      const left = parseSimple();
      if (accept('^')) return { type: 'bin', op: '^', left, right: parseUnary() };
      return left;
    }

    function parseSimple() {
      const token = peek();
      if (token.type === 'number') { next(); return { type: 'num', value: token.value }; }
      if (token.type === 'string') { next(); return { type: 'str', value: token.value }; }
      if (at('nil')) { next(); return { type: 'nil' }; }
      if (at('true')) { next(); return { type: 'bool', value: true }; }
      if (at('false')) { next(); return { type: 'bool', value: false }; }
      if (at('...')) { next(); return { type: 'vararg' }; }
      if (at('function')) {
        next(); return { type: 'func', ...parseFunctionBody(token.line) };
      }
      if (at('{')) return parseTable();
      return parseSuffixed();
    }

    function parseTable() {
      expect('{');
      const items = [];
      while (!at('}')) {
        if (at('[')) {
          next(); const key = parseExpression(); expect(']'); expect('=');
          items.push({ key, value: parseExpression() });
        } else if (peek().type === 'name' && tokens[pos + 1]?.value === '=') {
          const key = next().value; next();
          items.push({ key: { type: 'str', value: key }, value: parseExpression() });
        } else {
          items.push({ value: parseExpression() });
        }
        if (!accept(',') && !accept(';')) break;
      }
      expect('}');
      return { type: 'table', items };
    }

    function parseSuffixed() {
      let expr;
      if (peek().type === 'name') expr = { type: 'var', name: next().value };
      else if (at('(')) { next(); const inner = parseExpression(); expect(')'); expr = { type: 'paren', expr: inner }; }
      else throw new LuaError(`unexpected "${peek().value}"`, peek().line);
      for (;;) {
        if (accept('.')) expr = { type: 'member', obj: expr, name: expectName().value };
        else if (accept('[')) { const key = parseExpression(); expect(']'); expr = { type: 'index', obj: expr, key }; }
        else if (accept(':')) { const name = expectName().value; expr = { type: 'method', obj: expr, name, args: parseArgs() }; }
        else if (at('(') || at('{') || peek().type === 'string') expr = { type: 'call', func: expr, args: parseArgs() };
        else break;
      }
      return expr;
    }

    function parseArgs() {
      if (peek().type === 'string') { const value = next().value; return [{ type: 'str', value }]; }
      if (at('{')) return [parseTable()];
      expect('(');
      const args = at(')') ? [] : parseExprList();
      expect(')');
      return args;
    }

    const body = parseBlock();
    if (peek().type !== 'eof') throw new LuaError(`unexpected "${peek().value}"`, peek().line);
    return { type: 'Chunk', body };
  }

  function compile(source, options = {}) {
    let ast;
    try { ast = parse(source); }
    catch (error) { return { ok: false, error: error.message, line: error.line || null }; }
    try {
      const js = options.lifecycle ? compileLifecycle(ast) : compileBody(ast);
      return { ok: true, code: js };
    } catch (error) {
      return { ok: false, error: error.message, line: error.line || null };
    }
  }

  class Compiler {
    constructor({ instance = false } = {}) {
      this.scopes = [{ map: new Map() }];
      this.instance = instance;
      this.out = [];
      this.indent = 0;
    }
    pushScope(entries = []) { this.scopes.push({ map: new Map(entries) }); }
    popScope() { this.scopes.pop(); }
    declare(name, jsName, instance = false) { this.scopes[this.scopes.length - 1].map.set(name, { js: jsName, instance }); }
    lookup(name) {
      for (let i = this.scopes.length - 1; i >= 0; i -= 1) if (this.scopes[i].map.has(name)) return this.scopes[i].map.get(name);
      return null;
    }
    name(name) {
      const found = this.lookup(name);
      if (found) return found.js;
      return name;
    }
    line(text) { this.out.push(`${'  '.repeat(this.indent)}${text}`); }
    expr(node) {
      switch (node.type) {
        case 'num': return String(node.value);
        case 'str': return JSON.stringify(node.value);
        case 'nil': return 'null';
        case 'bool': return String(node.value);
        case 'var': return this.name(node.name);
        case 'paren': return `(${this.expr(node.expr)})`;
        case 'member': return `${this.expr(node.obj)}.${node.name}`;
        case 'index': return `__L.get(${this.expr(node.obj)}, ${this.expr(node.key)})`;
        case 'call': return `${this.expr(node.func)}(${node.args.map((arg) => this.expr(arg)).join(', ')})`;
        case 'method': return `${this.expr(node.obj)}.${node.name}(${node.args.map((arg) => this.expr(arg)).join(', ')})`;
        case 'table': {
          const positional = node.items.filter((item) => !item.key);
          const keyed = node.items.filter((item) => item.key);
          if (!keyed.length) return `[${positional.map((item) => this.expr(item.value)).join(', ')}]`;
          if (!positional.length) return `({ ${keyed.map((item) => `${this.keyLiteral(item.key)}: ${this.expr(item.value)}`).join(', ')} })`;
          return `__L.tab([${positional.map((item) => this.expr(item.value)).join(', ')}], { ${keyed.map((item) => `${this.keyLiteral(item.key)}: ${this.expr(item.value)}`).join(', ')} })`;
        }
        case 'func': {
          this.pushScope();
          const params = node.params.map((param) => { const js = `L_${param}`; this.declare(param, js); return js; });
          const body = this.captureBlock(node.body);
          this.popScope();
          return `function(${params.join(', ')}) {\n${body}\n}`;
        }
        case 'unary':
          if (node.op === 'not') return `(!__L.t(${this.expr(node.expr)}))`;
          if (node.op === '#') return `__L.len(${this.expr(node.expr)})`;
          return `(-(${this.expr(node.expr)}))`;
        case 'bin': {
          if (node.op === 'and') return `(__L.t(${this.expr(node.left)}) ? ${this.expr(node.right)} : ${this.expr(node.left)})`;
          if (node.op === 'or') return `(__L.t(${this.expr(node.left)}) ? ${this.expr(node.left)} : ${this.expr(node.right)})`;
          if (node.op === '..') return `__L.cat(${this.expr(node.left)}, ${this.expr(node.right)})`;
          if (node.op === '~=') return `(${this.expr(node.left)} !== ${this.expr(node.right)})`;
          if (node.op === '//') return `Math.floor(${this.expr(node.left)} / ${this.expr(node.right)})`;
          if (node.op === '^') return `(${this.expr(node.left)} ** ${this.expr(node.right)})`;
          return `(${this.expr(node.left)} ${node.op} ${this.expr(node.right)})`;
        }
        case 'vararg': return 'Array.prototype.slice.call(arguments)';
        default: throw new LuaError(`cannot compile expression ${node.type}`);
      }
    }
    keyLiteral(key) {
      if (key.type === 'str') return JSON.stringify(key.value);
      if (key.type === 'num') return JSON.stringify(String(key.value));
      return `[${this.expr(key)}]`;
    }
    captureBlock(statements) {
      const saved = this.out; const savedIndent = this.indent;
      this.out = []; this.indent = 0;
      for (const statement of statements) this.statement(statement);
      const text = this.out.join('\n');
      this.out = saved; this.indent = savedIndent;
      return text;
    }
    statement(node) {
      switch (node.type) {
        case 'Local': {
          node.names.forEach((name, index) => {
            const js = this.lookup(name)?.js || `L_${name}`;
            const value = node.values[index] ? this.expr(node.values[index]) : 'null';
            if (this.instance) this.line(`this.${js.replace(/^this\./, '')} = ${value};`);
            else this.line(`let ${js} = ${value};`);
            if (this.instance) this.declare(name, `this.${js.replace(/^this\./, '')}`, true);
            else this.declare(name, js, false);
          });
          return;
        }
        case 'Assign': {
          const values = node.values.map((value) => this.expr(value));
          if (node.targets.length > 1 || values.length > 1) {
            this.line(`const __tmp${this.indent} = [${values.join(', ')}];`);
            node.targets.forEach((target, index) => this.assignTarget(target, `__tmp${this.indent}[${index}]`));
          } else {
            this.assignTarget(node.targets[0], values[0] || 'null');
          }
          return;
        }
        case 'CallStatement': this.line(`${this.expr(node.call)};`); return;
        case 'Function':
          if (node.target.type === 'var') {
            const name = node.target.name;
            const js = this.lookup(name)?.js || name;
            this.pushScope();
            const params = node.func.params.map((param) => { const p = `L_${param}`; this.declare(param, p); return p; });
            const body = this.captureBlock(node.func.body);
            this.popScope();
            if (this.instance) this.line(`this.${js.replace(/^this\./, '')} = function(${params.join(', ')}) {\n${body}\n};`);
            else this.line(`function ${js}(${params.join(', ')}) {\n${body}\n}`);
          } else {
            this.line(`${this.expr(node.target)} = function(...) {};`);
          }
          return;
        case 'LocalFunction':
          this.pushScope();
          const params = node.func.params.map((param) => { const p = `L_${param}`; this.declare(param, p); return p; });
          const body = this.captureBlock(node.func.body);
          this.popScope();
          if (this.instance) {
            this.declare(node.name, `this.L_${node.name}`, true);
            this.line(`this.L_${node.name} = function(${params.join(', ')}) {\n${body}\n};`);
          } else {
            this.declare(node.name, `L_${node.name}`);
            this.line(`function L_${node.name}(${params.join(', ')}) {\n${body}\n}`);
          }
          return;
        case 'If': {
          node.branches.forEach((branch, index) => {
            this.line(`${index === 0 ? 'if' : 'else if'} (__L.t(${this.expr(branch.condition)})) {`);
            this.indent += 1; for (const statement of branch.body) this.statement(statement); this.indent -= 1;
            this.line('}');
          });
          if (node.elseBody) {
            this.line('else {');
            this.indent += 1; for (const statement of node.elseBody) this.statement(statement); this.indent -= 1;
            this.line('}');
          }
          return;
        }
        case 'While':
          this.line(`while (__L.t(${this.expr(node.condition)})) {`);
          this.indent += 1; for (const statement of node.body) this.statement(statement); this.indent -= 1;
          this.line('}'); return;
        case 'Repeat':
          this.line('do {');
          this.indent += 1; for (const statement of node.body) this.statement(statement); this.indent -= 1;
          this.line(`} while (!__L.t(${this.expr(node.condition)}));`); return;
        case 'ForNumeric': {
          const start = this.expr(node.start), stop = this.expr(node.stop), step = node.step ? this.expr(node.step) : '1';
          this.line(`{ const __s = ${start}, __e = ${stop}, __st = ${step}; for (let ${this.name(node.name)} = __s; __st >= 0 ? ${this.name(node.name)} <= __e : ${this.name(node.name)} >= __e; ${this.name(node.name)} += __st) {`);
          this.indent += 1; for (const statement of node.body) this.statement(statement); this.indent -= 1;
          this.line('} }'); return;
        }
        case 'ForIn': {
          const iter = this.expr(node.iter);
          const names = node.names.map((name) => `L_${name}`);
          this.line(`for (const [${names.join(', ')}] of __L.iter(${iter})) {`);
          node.names.forEach((name, index) => this.declare(name, names[index]));
          this.indent += 1; for (const statement of node.body) this.statement(statement); this.indent -= 1;
          this.line('}'); return;
        }
        case 'Do':
          for (const statement of node.body) this.statement(statement);
          return;
        case 'Return': this.line(`return ${node.values.length > 1 ? `[${node.values.map((v) => this.expr(v)).join(', ')}]` : (node.values[0] ? this.expr(node.values[0]) : '')};`); return;
        case 'Break': this.line('break;'); return;
        default: throw new LuaError(`cannot compile statement ${node.type}`);
      }
    }
    assignTarget(target, value) {
      if (target.type === 'var') { this.line(`${this.name(target.name)} = ${value};`); return; }
      if (target.type === 'member') { this.line(`${this.expr(target.obj)}.${target.name} = ${value};`); return; }
      if (target.type === 'index') { this.line(`__L.set(${this.expr(target.obj)}, ${this.expr(target.key)}, ${value});`); return; }
      throw new LuaError('invalid assignment target');
    }
  }

  function prologue() {
    return [
      'const __L = {',
      '  t: (v) => v !== false && v !== null && v !== undefined,',
      '  cat: (a, b) => String(a ?? "nil") + String(b ?? "nil"),',
      '  len: (v) => v == null ? 0 : (typeof v === "string" || Array.isArray(v)) ? v.length : Object.keys(v).length,',
      '  get: (v, k) => v == null ? null : (Array.isArray(v) && typeof k === "number") ? (v[k - 1] ?? null) : v[k],',
      '  set: (v, k, x) => { if (v == null) return; if (Array.isArray(v) && typeof k === "number") v[k - 1] = x; else v[k] = x; },',
      '  tab: (a, o) => Object.assign(a, o),',
      '  iter: (v) => Array.isArray(v) ? v.map((x, i) => [i + 1, x]) : Object.entries(v || {}),',
      '};',
    ].join('\n');
  }

  function compileBody(ast) {
    const compiler = new Compiler({ instance: false });
    for (const statement of ast.body) compiler.statement(statement);
    return `${prologue()}\n${compiler.out.join('\n')}`;
  }

  function compileLifecycle(ast) {
    const lifecycle = new Map();
    const top = [];
    for (const statement of ast.body) {
      if (statement.type === 'Function' && statement.target.type === 'var' && LIFECYCLE[statement.target.name]) {
        lifecycle.set(LIFECYCLE[statement.target.name], { ...statement.func, luaName: statement.target.name });
      } else {
        top.push(statement);
      }
    }
    if (!lifecycle.size) return compileBody(ast);
    const compiler = new Compiler({ instance: true });
    const topCode = compiler.captureBlock(top);
    const methods = [];
    for (const [method, func] of lifecycle) {
      compiler.pushScope();
      const params = func.params.map((param) => { const js = `L_${param}`; compiler.declare(param, js); return js; });
      const body = compiler.captureBlock(func.body);
      compiler.popScope();
      methods.push(`  ${method}(${params.join(', ')}) {\n    const api = this.game ? this.game.api() : null;\n    const entity = this.entity || null;\n    const input = api ? api.input : null;\n    const log = api ? api.log : console.log;\n${body}\n  }`);
    }
    return [
      prologue(),
      'return class CascadeLuaScript {',
      '  constructor() {',
      '    const api = this.game ? this.game.api() : null;',
      '    const entity = this.entity || null;',
      '    const input = api ? api.input : null;',
      '    const log = api ? api.log : console.log;',
      topCode ? topCode.split('\n').map((line) => `    ${line}`).join('\n') : '',
      '  }',
      methods.join('\n'),
      '};',
    ].filter(Boolean).join('\n');
  }

  /* ---- visual graph to Lua (supported subset) ---- */
  function graphToLua(script, defs) {
    const graph = script?.graph || { nodes: [], edges: [] };
    const byId = new Map((graph.nodes || []).map((node) => [node.id, node]));
    const defOf = (node) => {
      if (!node || typeof defs !== 'function') return null;
      return defs(node.type) || defs(node) || null;
    };
    const outEdge = (nodeId, pin) => (graph.edges || []).find((item) => item.from?.node === nodeId && item.from?.pin === pin);
    const inEdge = (nodeId, pin) => (graph.edges || []).find((item) => item.to?.node === nodeId && item.to?.pin === pin);
    const sourceNode = (nodeId, pin) => byId.get(inEdge(nodeId, pin)?.from?.node);
    const skipped = [];
    const expr = (node, pin, depth = 0) => {
      if (depth > 24) return 'nil';
      const source = sourceNode(node.id, pin);
      if (!source) return literal(node.config?.[pin]);
      const def = defOf(source);
      const cfg = source.config || {};
      if (source.type === 'data.math') {
        const a = expr(source, 'a', depth + 1), b = expr(source, 'b', depth + 1);
        if (cfg.op === 'min') return `math.min(${a}, ${b})`;
        if (cfg.op === 'max') return `math.max(${a}, ${b})`;
        const ops = { add: '+', sub: '-', mul: '*', div: '/' };
        return `(${a} ${ops[cfg.op] || (['+', '-', '*', '/'].includes(cfg.op) ? cfg.op : '+')} ${b})`;
      }
      if (source.type === 'data.text' || source.type === 'text') return JSON.stringify(String(cfg.value || ''));
      if (source.type === 'data.number' || source.type === 'number') return String(Number(cfg.value) || 0);
      if (source.type === 'input.axis') return `input.axis(${JSON.stringify(cfg.action || 'horizontal')})`;
      if (source.type === 'input.keyHeld') return `input.held(${JSON.stringify(cfg.key || 'Space')})`;
      if (source.type === 'input.keyPressed' || source.type === 'event.keyPressed') return `input.justPressed(${JSON.stringify(cfg.key || 'Space')})`;
      if (source.type === 'data.self') return 'entity';
      if (source.type === 'variable.get') return `api.getVar(${JSON.stringify(cfg.name || 'score')})`;
      if (source.type === 'data.random') return `(math.random() * ((${expr(source, 'max', depth + 1)}) - (${expr(source, 'min', depth + 1)})) + (${expr(source, 'min', depth + 1)}))`;
      if (source.type === 'data.position') return pin === 'y' ? '(entity.worldY or entity.y)' : '(entity.worldX or entity.x)';
      if (source.type === 'data.velocity') return `api.getVelocity(entity, ${JSON.stringify(pin === 'y' ? 'y' : 'x')})`;
      if (source.type === 'data.grounded') return 'api.isGrounded(entity)';
      if (source.type === 'data.and') return `((${expr(source, 'a', depth + 1)}) and (${expr(source, 'b', depth + 1)}))`;
      if (source.type === 'data.or') return `((${expr(source, 'a', depth + 1)}) or (${expr(source, 'b', depth + 1)}))`;
      if (source.type === 'data.not') return `(not (${expr(source, 'a', depth + 1)}))`;
      if (source.type === 'data.compare') {
        const op = cfg.op === '!=' ? '~=' : ['==', '>', '>=', '<', '<='].includes(cfg.op) ? cfg.op : '==';
        return `((${expr(source, 'a', depth + 1)}) ${op} (${expr(source, 'b', depth + 1)}))`;
      }
      skipped.push(def?.title || source.type);
      return 'nil';
    };
    const literal = (value) => {
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (value === undefined || value === null) return 'nil';
      return JSON.stringify(String(value));
    };
    const actionOne = (node, indent, seen = new Set()) => {
      const prefix = '  '.repeat(indent);
      if (!node) return `${prefix}-- missing node`;
      if (seen.has(node.id)) return `${prefix}-- cycle stopped`;
      seen.add(node.id);
      const cfg = node.config || {};
      switch (node.type) {
        case 'action.log': return `${prefix}log(${expr(node, 'value') !== 'nil' ? expr(node, 'value') : JSON.stringify(String(cfg.message || cfg.value || ''))})`;
        case 'action.setVelocity': return `${prefix}api.setVelocity(api.entity(${JSON.stringify(cfg.entityId || '')}) or entity, ${expr(node, 'x')}, ${expr(node, 'y')})`;
        case 'action.applyImpulse': return `${prefix}api.applyImpulse(api.entity(${JSON.stringify(cfg.entityId || '')}) or entity, ${expr(node, 'x')}, ${expr(node, 'y')})`;
        case 'action.setPosition': return `${prefix}api.setPosition(api.entity(${JSON.stringify(cfg.entityId || '')}) or entity, ${expr(node, 'x')}, ${expr(node, 'y')})`;
        case 'action.translate': return `${prefix}api.setPosition(entity, entity.x + ${expr(node, 'x')}, entity.y + ${expr(node, 'y')})`;
        case 'action.setRotation': return `${prefix}entity.rotation = ${expr(node, 'value')}`;
        case 'action.setScale': return `${prefix}entity.scaleX = ${expr(node, 'x')}\n${prefix}entity.scaleY = ${expr(node, 'y')}`;
        case 'action.setVisible': return `${prefix}entity.visible = ${expr(node, 'visible') !== 'nil' ? expr(node, 'visible') : 'true'}`;
        case 'action.win': return `${prefix}api.win(${expr(node, 'message') !== 'nil' ? expr(node, 'message') : JSON.stringify(String(cfg.message || 'You win!'))})`;
        case 'variable.set': return `${prefix}api.setVar(${JSON.stringify(cfg.name || 'score')}, ${expr(node, 'value')})`;
        case 'variable.add': return `${prefix}api.setVar(${JSON.stringify(cfg.name || 'score')}, (api.getVar(${JSON.stringify(cfg.name || 'score')}) or 0) + ${expr(node, 'amount')})`;
        case 'action.showUI': return `${prefix}local __ui = api.entity(${JSON.stringify(cfg.entityId || '')}) or entity\n${prefix}if __ui then\n${prefix}  __ui.visible = true\n${prefix}  if __ui.components and __ui.components.UIElement then\n${prefix}    __ui.components.UIElement.visible = true\n${prefix}  end\n${prefix}end`;
        case 'action.hideUI': return `${prefix}local __ui = api.entity(${JSON.stringify(cfg.entityId || '')}) or entity\n${prefix}if __ui then\n${prefix}  __ui.visible = false\n${prefix}  if __ui.components and __ui.components.UIElement then\n${prefix}    __ui.components.UIElement.visible = false\n${prefix}  end\n${prefix}end`;
        case 'action.playSound': return `${prefix}api.playSound(${JSON.stringify(cfg.assetId || '')})`;
        case 'action.spawn': return `${prefix}api.spawn(${JSON.stringify(cfg.prefabId || '')}, ${expr(node, 'x')}, ${expr(node, 'y')})`;
        case 'action.destroy': return `${prefix}api.destroy(api.entity(${JSON.stringify(cfg.entityId || '')}) or entity)`;
        case 'action.branch': {
          const cond = expr(node, 'condition');
          const trueBody = chain(node, 'true', indent + 1, new Set(seen));
          const falseBody = chain(node, 'false', indent + 1, new Set(seen));
          return `${prefix}if ${cond === 'nil' ? 'false' : cond} then\n${trueBody || `${prefix}  -- empty`}\n${falseBody ? `${prefix}else\n${falseBody}\n` : ''}${prefix}end`;
        }
        case 'event.start': case 'event.update': case 'event.fixedUpdate':
        case 'event.collisionEnter': case 'event.collisionExit': case 'event.uiClick':
        case 'event.keyPressed': case 'event.sceneLoad': case 'event.sceneUnload': case 'event.destroy':
          return chain(node, 'next', indent, seen);
        default:
          skipped.push(defOf(node)?.title || node.type);
          return `${prefix}-- TODO: ${defOf(node)?.title || node.type}`;
      }
    };
    const action = (node, indent, seen = new Set()) => {
      const line = actionOne(node, indent, seen);
      if (!node || String(node.type || '').startsWith('event.')) return line;
      const more = chain(node, 'next', indent, seen);
      return more ? `${line}\n${more}` : line;
    };
    const chain = (node, pin, indent, seen = new Set()) => {
      const next = byId.get(outEdge(node.id, pin)?.to?.node);
      if (!next || seen.has(next.id)) return '';
      return action(next, indent, seen);
    };
    const triggers = (graph.nodes || []).filter((node) => defOf(node)?.trigger);
    const blocks = triggers.map((node) => {
      const fn = { start: 'on_start', update: 'on_update', fixedUpdate: 'on_fixed_update', collisionEnter: 'on_collision_enter', collisionExit: 'on_collision_exit', uiClick: 'on_ui_click', keyPressed: 'on_key_pressed', sceneLoad: 'on_scene_load', sceneUnload: 'on_scene_unload', destroy: 'on_destroy' }[defOf(node).trigger] || 'on_update';
      const params = fn === 'on_update' || fn === 'on_fixed_update' ? '(dt)' : '(event)';
      return `function ${fn}${params}\n${chain(node, 'next', 1) || '  -- connect an action to this trigger'}\nend`;
    });
    const header = `-- Cascade Lua generated from “${script?.name || 'Visual Script'}”\n-- Switch back to nodes any time from the script menu.\n`;
    return { code: `${header}${blocks.join('\n\n') || 'function on_update(dt)\nend'}\n`, skipped: [...new Set(skipped)] };
  }

  const api = { compile, parse, lex, graphToLua, LIFECYCLE, version: 1 };
  root.CascadeLua = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
