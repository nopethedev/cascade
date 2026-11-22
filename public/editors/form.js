/* Form builder: field editor, publish toggle and preview. */
(function () {
  const DOC = window.__DOC__;
  if (!DOC) return;
  const data =
    DOC.content && Array.isArray(DOC.content.fields)
      ? DOC.content
      : { title: 'Untitled form', description: '', success: 'Thanks — your response was recorded.', fields: [] };

  const container = document.getElementById('form-fields');
  const countEl = document.getElementById('field-count');
  const titleInput = document.getElementById('form-title');
  const descInput = document.getElementById('form-description');
  const successInput = document.getElementById('form-success');
  const publishBtn = document.getElementById('form-publish');
  const publishState = document.getElementById('publish-state');
  const linkWrap = document.getElementById('public-link-wrap');
  const linkInput = document.getElementById('public-link');
  const responseCount = document.getElementById('response-count');

  let isPublic = !!DOC.isPublic;
  let slug = DOC.slug;

  const TYPES = ['text', 'textarea', 'email', 'number', 'date', 'select', 'radio', 'checkbox'];
  const LABELS = {
    text: 'Short text', textarea: 'Paragraph', email: 'Email', number: 'Number', date: 'Date',
    select: 'Dropdown', radio: 'Single choice', checkbox: 'Checkboxes',
  };

  titleInput.value = data.title || '';
  descInput.value = data.description || '';
  successInput.value = data.success || '';
  titleInput.addEventListener('input', () => {
    data.title = titleInput.value;
    ws.schedule();
  });
  descInput.addEventListener('input', () => {
    data.description = descInput.value;
    ws.schedule();
  });
  successInput.addEventListener('input', () => {
    data.success = successInput.value;
    ws.schedule();
  });

  const uid = () => 'q' + Math.random().toString(36).slice(2, 8);

  function updatePublicUi() {
    publishState.textContent = isPublic ? 'published' : 'private';
    publishState.className = 'badge ' + (isPublic ? 'badge-ok' : '');
    publishBtn.textContent = isPublic ? 'Unpublish form' : 'Publish form';
    linkWrap.hidden = !isPublic;
    if (isPublic && slug) linkInput.value = `${location.origin}/forms/${slug}`;
  }

  function smallButton(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${cls} btn-sm`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function row(labelText, control) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.className = 'label';
    label.textContent = labelText;
    wrap.append(label, control);
    return wrap;
  }

  function render() {
    container.textContent = '';
    data.fields.forEach((f, i) => {
      const card = document.createElement('div');
      card.className = 'field-card';

      const head = document.createElement('div');
      head.className = 'field-card-head';
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = LABELS[f.type] || f.type;
      const actions = document.createElement('div');
      actions.className = 'row';
      actions.style.gap = '4px';
      actions.append(
        smallButton('↑', 'btn-quiet', () => {
          if (i === 0) return;
          [data.fields[i - 1], data.fields[i]] = [data.fields[i], data.fields[i - 1]];
          render();
          ws.schedule();
        }),
        smallButton('↓', 'btn-quiet', () => {
          if (i === data.fields.length - 1) return;
          [data.fields[i + 1], data.fields[i]] = [data.fields[i], data.fields[i + 1]];
          render();
          ws.schedule();
        }),
        smallButton('Delete', 'btn-danger', () => {
          data.fields.splice(i, 1);
          render();
          ws.schedule();
        }),
      );
      head.append(badge, actions);

      const labelInput = document.createElement('input');
      labelInput.value = f.label || '';
      labelInput.placeholder = 'Question';
      labelInput.addEventListener('input', () => {
        f.label = labelInput.value;
        ws.schedule();
      });

      const typeSelect = document.createElement('select');
      for (const t of TYPES) {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = LABELS[t];
        opt.selected = t === f.type;
        typeSelect.append(opt);
      }
      typeSelect.addEventListener('change', () => {
        f.type = typeSelect.value;
        if (['select', 'radio', 'checkbox'].includes(f.type) && !(f.options || []).length) f.options = ['Option 1', 'Option 2'];
        render();
        ws.schedule();
      });

      const required = document.createElement('label');
      required.className = 'check';
      const req = document.createElement('input');
      req.type = 'checkbox';
      req.checked = !!f.required;
      req.addEventListener('change', () => {
        f.required = req.checked;
        ws.schedule();
      });
      const reqText = document.createElement('span');
      reqText.textContent = 'Required';
      required.append(req, reqText);

      card.append(head, row('Question', labelInput), row('Type', typeSelect));

      if (['select', 'radio', 'checkbox'].includes(f.type)) {
        const options = document.createElement('textarea');
        options.rows = Math.max(3, (f.options || []).length);
        options.value = (f.options || []).join('\n');
        options.placeholder = 'One option per line';
        options.addEventListener('input', () => {
          f.options = options.value.split('\n').map((s) => s.trim()).filter(Boolean);
          ws.schedule();
        });
        card.append(row('Options', options));
      }

      const help = document.createElement('input');
      help.value = f.help || '';
      help.placeholder = 'Optional hint under the question';
      help.addEventListener('input', () => {
        f.help = help.value;
        ws.schedule();
      });
      card.append(row('Help text', help), required);
      container.append(card);
    });

    countEl.textContent = `${data.fields.length} field${data.fields.length === 1 ? '' : 's'}`;
    updatePublicUi();
  }

  const ws = window.Workspace.create({
    id: DOC.id,
    kind: 'form',
    version: DOC.version,
    content: data,
    isPublic,
    filename: DOC.filename,
    apply(content) {
      if (content && Array.isArray(content.fields)) {
        data.title = content.title || '';
        data.description = content.description || '';
        data.success = content.success || '';
        data.fields = content.fields;
        titleInput.value = data.title;
        descInput.value = data.description;
        successInput.value = data.success;
        render();
      }
    },
    collect() {
      return {
        title: data.title,
        description: data.description,
        success: data.success,
        fields: data.fields,
      };
    },
  });

  document.querySelectorAll('#add-fields [data-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.add;
      const f = { id: uid(), type, label: LABELS[type], required: false, options: [], help: '' };
      if (['select', 'radio', 'checkbox'].includes(type)) f.options = ['Option 1', 'Option 2'];
      data.fields.push(f);
      render();
      ws.schedule();
    });
  });

  publishBtn.addEventListener('click', async () => {
    const next = !isPublic;
    const r = await fetch(`/api/files/${DOC.id}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isPublic: next }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return window.cascadeToast?.(j.error || 'Could not publish', true);
    isPublic = !!j.isPublic;
    slug = j.slug || slug;
    updatePublicUi();
    window.cascadeToast?.(isPublic ? 'Form published — share the link' : 'Form unpublished');
  });

  document.getElementById('copy-link').addEventListener('click', () => {
    if (linkInput.value) window.cascadeCopy?.(linkInput.value, 'Form link copied');
  });

  document.getElementById('form-preview').addEventListener('click', () => {
    if (!isPublic) return window.cascadeToast?.('Publish the form first to preview it', true);
    window.open(`/forms/${slug}`, '_blank', 'noopener');
  });

  fetch(`/api/workspace/docs/${DOC.id}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j) return;
      isPublic = !!j.isPublic;
      slug = j.slug || slug;
      updatePublicUi();
      responseCount.textContent = `${j.responses || 0} response${j.responses === 1 ? '' : 's'} so far`;
    })
    .catch(() => {});

  render();
})();
