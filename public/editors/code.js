/* Code editor: file explorer, tabs and a syntax-highlighted textarea. */
(function () {
  const DOC = window.__DOC__;
  if (!DOC) return;
  const data =
    DOC.content && Array.isArray(DOC.content.files) && DOC.content.files.length
      ? DOC.content
      : { files: [{ name: 'index.js', language: 'javascript', text: '' }], active: 0 };
  let active = Math.min(data.active || 0, data.files.length - 1);

  const input = document.getElementById('code-input');
  const highlightEl = document.getElementById('code-highlight');
  const tabsEl = document.getElementById('code-tabs');
  const listEl = document.getElementById('code-file-list');
  const status = document.getElementById('code-status');

  const file = () => data.files[active];
  const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const EXT = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript',
    json: 'json', html: 'html', htm: 'html', css: 'css', py: 'python', md: 'markdown', yml: 'yaml', yaml: 'yaml',
    sh: 'shell', txt: 'plain',
  };
  const langFor = (name) => EXT[(name.split('.').pop() || '').toLowerCase()] || 'plain';

  const KEYWORDS = {
    javascript: 'const let var function return if else for while import from export default class new await async try catch throw typeof of in null true false this switch case break continue',
    python: 'def return if elif else for while import from class with as try except raise lambda None True False in not and or pass',
    json: 'true false null',
    css: '',
    html: '',
    markdown: '',
    plain: '',
    yaml: 'true false null',
    shell: 'if then else fi for do done case esac function export echo cd',
  };

  function highlight(text, lang) {
    const kw = KEYWORDS[lang] || '';
    const comment =
      lang === 'python' || lang === 'yaml' || lang === 'shell'
        ? '#[^\\n]*'
        : lang === 'html'
          ? '<!--[\\s\\S]*?-->'
          : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
    const str = '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`';
    const num = '\\b\\d+(?:\\.\\d+)?\\b';
    const kwPart = kw ? `|\\b(?:${kw.trim().split(/\s+/).join('|')})\\b` : '';
    const re = new RegExp(`(${comment})|(${str})|(${num})${kwPart}`, 'g');
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      out += escape(text.slice(last, m.index));
      const cls = m[1] ? 'cmt' : m[2] ? 'str' : m[3] ? 'num' : 'kw';
      out += `<span class="tok-${cls}">${escape(m[0])}</span>`;
      last = m.index + m[0].length;
      if (m[0] === '') re.lastIndex += 1;
    }
    out += escape(text.slice(last));
    return out + '\n';
  }

  function updateHighlight() {
    highlightEl.innerHTML = highlight(file().text || '', file().language || langFor(file().name));
    highlightEl.scrollTop = input.scrollTop;
    highlightEl.scrollLeft = input.scrollLeft;
  }

  function updateStatus() {
    const text = file().text || '';
    const lines = text ? text.split('\n').length : 0;
    status.textContent = `${file().name} · ${lines} lines · ${text.length} chars`;
  }

  function renderTabs() {
    tabsEl.textContent = '';
    data.files.forEach((f, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `code-tab${i === active ? ' is-active' : ''}`;
      b.textContent = f.name;
      b.title = f.name;
      b.addEventListener('click', () => {
        active = i;
        render();
      });
      tabsEl.append(b);
    });
  }

  function renderList() {
    listEl.textContent = '';
    data.files.forEach((f, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `code-file${i === active ? ' is-active' : ''}`;
      const dot = document.createElement('span');
      dot.className = 'code-file-ext';
      dot.textContent = (f.name.split('.').pop() || 'txt').slice(0, 4);
      const label = document.createElement('span');
      label.textContent = f.name;
      b.append(dot, label);
      b.addEventListener('click', () => {
        active = i;
        render();
      });
      listEl.append(b);
    });
  }

  function render() {
    input.value = file().text || '';
    updateHighlight();
    updateStatus();
    renderTabs();
    renderList();
  }

  const ws = window.Workspace.create({
    id: DOC.id,
    kind: 'code',
    version: DOC.version,
    content: { files: data.files, active },
    isPublic: DOC.isPublic,
    filename: DOC.filename,
    apply(content) {
      if (content && Array.isArray(content.files) && content.files.length) {
        data.files = content.files;
        active = Math.min(content.active || 0, data.files.length - 1);
        render();
      }
    },
    collect() {
      return { files: data.files, active };
    },
  });

  input.addEventListener('input', () => {
    file().text = input.value;
    updateHighlight();
    updateStatus();
    ws.schedule();
  });
  input.addEventListener('scroll', () => {
    highlightEl.scrollTop = input.scrollTop;
    highlightEl.scrollLeft = input.scrollLeft;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = input.selectionStart;
      input.value = `${input.value.slice(0, start)}  ${input.value.slice(input.selectionEnd)}`;
      input.selectionStart = input.selectionEnd = start + 2;
      file().text = input.value;
      updateHighlight();
      ws.schedule();
    }
  });

  document.getElementById('code-new').addEventListener('click', () => {
    const name = window.prompt('File name', 'untitled.js');
    if (!name) return;
    if (data.files.some((f) => f.name === name)) return window.cascadeToast?.('That file already exists', true);
    data.files.push({ name: name.slice(0, 80), language: langFor(name), text: '' });
    active = data.files.length - 1;
    render();
    ws.schedule();
    input.focus();
  });

  document.getElementById('code-rename').addEventListener('click', () => {
    const name = window.prompt('Rename file', file().name);
    if (!name) return;
    file().name = name.slice(0, 80);
    file().language = langFor(name);
    render();
    ws.schedule();
  });

  document.getElementById('code-delete').addEventListener('click', () => {
    if (data.files.length === 1) return window.cascadeToast?.('Keep at least one file in the project', true);
    if (!window.confirm(`Delete ${file().name}?`)) return;
    data.files.splice(active, 1);
    active = Math.max(0, active - 1);
    render();
    ws.schedule();
  });

  render();
})();
