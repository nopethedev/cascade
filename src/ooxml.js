// Minimal, dependency-free XML reader for OOXML parts.
//
// Office Open XML packages are plain ZIPs of well-formed XML. Pulling in a full
// DOM parser just to read slide shapes would add a runtime dependency to a
// project that vendors everything, so this keeps a tiny tree with the helpers
// the importer needs. It is deliberately not an XML validator: it tolerates
// the handful of constructs Office writes (namespace prefixes, self-closing
// tags, comments, CDATA, numeric entities).

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

export function decodeEntities(value) {
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function parseAttributes(source) {
  const attrs = {};
  const pattern = /([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(source))) {
    attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

// `>` can legally appear inside a quoted attribute value, so find the closing
// bracket while tracking quotes instead of using indexOf('>').
function tagEnd(xml, from) {
  let quote = '';
  for (let i = from; i < xml.length; i += 1) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const text = String(xml || '');
  const pushText = (value) => {
    if (!value) return;
    stack[stack.length - 1].children.push({ name: '#text', text: decodeEntities(value), children: [] });
  };

  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      pushText(text.slice(i));
      break;
    }
    if (lt > i) pushText(text.slice(i, lt));

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      pushText(text.slice(lt + 9, end < 0 ? text.length : end));
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
      const end = tagEnd(text, lt + 2);
      i = end < 0 ? text.length : end + 1;
      continue;
    }

    const end = tagEnd(text, lt + 1);
    if (end < 0) {
      pushText(text.slice(lt));
      break;
    }
    const raw = text.slice(lt + 1, end).trim();
    i = end + 1;
    if (!raw) continue;

    if (raw[0] === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1).trim() : raw;
    const space = body.search(/\s/);
    const name = space < 0 ? body : body.slice(0, space);
    if (!name) continue;

    const node = { name, attrs: parseAttributes(space < 0 ? '' : body.slice(space)), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }

  return root;
}

export function elements(node) {
  return (node?.children || []).filter((child) => child.name !== '#text');
}

export function child(node, name) {
  return (node?.children || []).find((entry) => entry.name === name) || null;
}

export function childrenOf(node, name) {
  return (node?.children || []).filter((entry) => entry.name === name);
}

export function find(node, name) {
  if (!node) return null;
  for (const entry of node.children || []) {
    if (entry.name === name) return entry;
    const hit = find(entry, name);
    if (hit) return hit;
  }
  return null;
}

export function findAll(node, name, out = []) {
  if (!node) return out;
  for (const entry of node.children || []) {
    if (entry.name === name) out.push(entry);
    findAll(entry, name, out);
  }
  return out;
}

export function attr(node, name, fallback = '') {
  return node?.attrs?.[name] ?? fallback;
}

export function textContent(node) {
  if (!node) return '';
  if (node.name === '#text') return node.text;
  let out = '';
  for (const entry of node.children || []) out += textContent(entry);
  return out;
}

/** Join nested text while preserving explicit line breaks. */
export function paragraphText(node) {
  let out = '';
  for (const entry of node?.children || []) {
    if (entry.name === '#text') out += entry.text;
    else if (entry.name === 'a:br') out += '\n';
    else if (entry.name === 'a:tab') out += '\t';
    else out += paragraphText(entry);
  }
  return out;
}
