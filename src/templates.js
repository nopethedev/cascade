// Built-in template gallery for the workspace editors.
// Each builder returns the editor's initial content object; ids stay stable so
// `POST /api/workspace/docs` can resolve a template by id.

export const KINDS = [
  { id: 'doc', label: 'Document', tag: 'Rich text', icon: 'DOC' },
  { id: 'sheet', label: 'Spreadsheet', tag: 'Cells & formulas', icon: 'XLS' },
  { id: 'deck', label: 'Presentation', tag: 'Slides', icon: 'PPT' },
  { id: 'pdf', label: 'PDF', tag: 'Annotate & sign', icon: 'PDF' },
  { id: 'board', label: 'Whiteboard', tag: 'Infinite canvas', icon: 'WBD' },
  { id: 'form', label: 'Form', tag: 'Collect answers', icon: 'FRM' },
  { id: 'code', label: 'Code file', tag: 'Editor + files', icon: 'CODE' },
  { id: 'site', label: 'Website', tag: 'Visual site builder', icon: 'WEB' },
  { id: 'roblox', label: 'Roblox place', tag: 'Studio relay + 3D', icon: 'RBX' },
];

export const CATEGORIES = ['blank', 'business', 'education', 'personal', 'blog', 'ecommerce', 'game', 'custom'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const doc = (html, extra = {}) => ({ html, header: extra.header || '', footer: extra.footer || '' });
const sheet = (cells, name = 'Sheet1') => ({ sheets: [{ name, rows: 32, cols: 12, cells }], active: 0 });
const deck = (slides) => ({
  w: 1280,
  h: 720,
  slides: slides.map((s, i) => ({
    id: `s${i + 1}`,
    bg: s.bg || '#101014',
    notes: s.notes || '',
    elements: s.elements || [],
    transition: s.transition || 'fade',
  })),
});
const text = (id, x, y, w, h, value, opts = {}) => ({
  id,
  type: 'text',
  x,
  y,
  w,
  h,
  text: value,
  size: opts.size || 28,
  color: opts.color || '#f4f4f5',
  bold: !!opts.bold,
  align: opts.align || 'left',
});
const rect = (id, x, y, w, h, fill) => ({ id, type: 'rect', x, y, w, h, fill: fill || '#e11d48' });
const code = (files) => ({ files, active: 0 });
const form = (title, description, fields) => ({
  title,
  description,
  success: 'Thanks — your response was recorded.',
  fields,
});
const field = (id, type, label, extra = {}) => ({ id, type, label, required: !!extra.required, options: extra.options || [], help: extra.help || '' });
const site = (brand, sections, theme = {}, seo = {}) => ({
  brand,
  sections,
  theme: {
    accent: theme.accent || '#e11d48',
    bg: theme.bg || '#0b0b10',
    surface: theme.surface || '#14141b',
    text: theme.text || '#f7f7f8',
    muted: theme.muted || '#a1a1aa',
    font: theme.font || 'Inter',
    radius: theme.radius ?? 14,
    maxWidth: theme.maxWidth || 1120,
  },
  seo: { title: seo.title || brand, description: seo.description || '', ogImage: seo.ogImage || '' },
  customCss: '',
});
const siteSection = (type, fields) => ({ id: `${type}-${Math.random().toString(36).slice(2, 7)}`, type, ...fields });
const roblox = (placeName, blank = false) => {
  const id = () => Math.random().toString(36).slice(2, 12);
  const workspace = { id: id(), className: 'Workspace', name: 'Workspace', props: { ClassName: 'Workspace' }, children: [] };
  if (!blank) {
    workspace.children.push(
      { id: id(), className: 'Part', name: 'Baseplate', props: { ClassName: 'Part', Anchored: true, Size: { x: 120, y: 1, z: 120 }, Position: { x: 0, y: 0, z: 0 }, Color: '#27272a', CanCollide: true }, children: [] },
      { id: id(), className: 'SpawnLocation', name: 'SpawnLocation', props: { ClassName: 'SpawnLocation', Anchored: true, Size: { x: 12, y: 1, z: 12 }, Position: { x: 0, y: 0.5, z: 0 }, Color: '#f59e0b', CanCollide: true }, children: [] },
    );
  }
  return {
    placeName,
    services: [
      workspace,
      { id: id(), className: 'ReplicatedStorage', name: 'ReplicatedStorage', props: { ClassName: 'ReplicatedStorage' }, children: [] },
      { id: id(), className: 'ServerScriptService', name: 'ServerScriptService', props: { ClassName: 'ServerScriptService' }, children: blank ? [] : [
        { id: id(), className: 'Script', name: 'GameLoop', props: { ClassName: 'Script', Source: '-- Cascade starter script\nlocal Players = game:GetService("Players")\n\nPlayers.PlayerAdded:Connect(function(player)\n\tprint("Welcome", player.Name)\nend)\n' }, children: [] },
      ] },
      { id: id(), className: 'StarterGui', name: 'StarterGui', props: { ClassName: 'StarterGui' }, children: blank ? [] : [
        { id: id(), className: 'ScreenGui', name: 'HUD', props: { ClassName: 'ScreenGui', Enabled: true }, children: [
          { id: id(), className: 'TextLabel', name: 'Title', props: { ClassName: 'TextLabel', Text: 'YOUR GAME', TextSize: 28, Position: { xs: 0, xo: 24, ys: 0, yo: 24 }, Size: { xs: 0, xo: 260, ys: 0, yo: 48 }, TextColor3: '#ffffff', BackgroundTransparency: 1 }, children: [] },
        ] },
      ] },
    ],
    pluginVersion: null,
    capturedAt: null,
  };
};

export const TEMPLATES = [
  // ---------------- documents ----------------
  {
    id: 'doc-blank', name: 'Blank document', kind: 'doc', category: 'blank',
    description: 'Start from an empty page.',
    build: () => doc('<h1>Untitled document</h1><p>Start typing…</p>'),
  },
  {
    id: 'doc-proposal', name: 'Business proposal', kind: 'doc', category: 'business',
    description: 'Cover, summary, scope and pricing.',
    build: () => doc(
      '<h1>Project proposal</h1><p><em>Prepared for {{client}} · {{date}}</em></p>' +
      '<h2>Summary</h2><p>One paragraph on the problem, the outcome and why now.</p>' +
      '<h2>Scope</h2><ul><li>Discovery and requirements</li><li>Design and build</li><li>Launch and handover</li></ul>' +
      '<h2>Timeline</h2><table><thead><tr><th>Phase</th><th>Weeks</th><th>Owner</th></tr></thead><tbody>' +
      '<tr><td>Discovery</td><td>1–2</td><td>—</td></tr><tr><td>Build</td><td>3–8</td><td>—</td></tr><tr><td>Launch</td><td>9</td><td>—</td></tr></tbody></table>' +
      '<h2>Investment</h2><p>Total: <strong>$0</strong></p>',
      { footer: 'Confidential — prepared by Cascade' },
    ),
  },
  {
    id: 'doc-notes', name: 'Meeting notes', kind: 'doc', category: 'business',
    description: 'Agenda, decisions and action items.',
    build: () => doc(
      '<h1>Meeting notes</h1><p><strong>Date:</strong> {{date}} · <strong>Attendees:</strong> …</p>' +
      '<h2>Agenda</h2><ol><li>…</li><li>…</li></ol>' +
      '<h2>Decisions</h2><ul><li>…</li></ul>' +
      '<h2>Action items</h2><table><thead><tr><th>Owner</th><th>Task</th><th>Due</th></tr></thead><tbody><tr><td>—</td><td>—</td><td>—</td></tr></tbody></table>',
    ),
  },
  {
    id: 'doc-class', name: 'Class notes', kind: 'doc', category: 'education',
    description: 'Topic outline with key terms.',
    build: () => doc(
      '<h1>Class notes</h1><p><strong>Topic:</strong> … · <strong>Date:</strong> {{date}}</p>' +
      '<h2>Key ideas</h2><ul><li>…</li><li>…</li></ul>' +
      '<h2>Definitions</h2><table><thead><tr><th>Term</th><th>Meaning</th></tr></thead><tbody><tr><td>—</td><td>—</td></tr></tbody></table>' +
      '<h2>Questions</h2><p>…</p>',
    ),
  },
  {
    id: 'doc-resume', name: 'Résumé', kind: 'doc', category: 'personal',
    description: 'Clean one-page CV layout.',
    build: () => doc(
      '<h1>Your Name</h1><p>City · email@example.com · +00 000 000 000</p>' +
      '<h2>Experience</h2><p><strong>Role</strong> — Company · 2022–now</p><ul><li>Result-oriented bullet.</li></ul>' +
      '<h2>Education</h2><p><strong>Degree</strong> — School · Year</p>' +
      '<h2>Skills</h2><p>Skill, skill, skill</p>',
    ),
  },

  // ---------------- spreadsheets ----------------
  {
    id: 'sheet-blank', name: 'Blank spreadsheet', kind: 'sheet', category: 'blank',
    description: 'A grid with formulas ready.',
    build: () => sheet({}),
  },
  {
    id: 'sheet-budget', name: 'Budget planner', kind: 'sheet', category: 'business',
    description: 'Income, expenses and totals that calculate.',
    build: () => sheet({
      A1: { v: 'Budget', b: true }, A2: { v: 'Item', b: true }, B2: { v: 'Category', b: true }, C2: { v: 'Amount', b: true },
      A3: { v: 'Income' }, B3: { v: 'Salary' }, C3: { v: '4200' },
      A4: { v: 'Rent' }, B4: { v: 'Housing' }, C4: { v: '1350' },
      A5: { v: 'Groceries' }, B5: { v: 'Food' }, C5: { v: '420' },
      A6: { v: 'Transport' }, B6: { v: 'Travel' }, C6: { v: '130' },
      A7: { v: 'Total', b: true }, C7: { f: '=SUM(C3:C6)', b: true },
    }),
  },
  {
    id: 'sheet-invoice', name: 'Invoice', kind: 'sheet', category: 'business',
    description: 'Line items, subtotal and tax.',
    build: () => sheet({
      A1: { v: 'INVOICE', b: true }, A2: { v: 'Client' }, B2: { v: '' },
      A4: { v: 'Description', b: true }, B4: { v: 'Qty', b: true }, C4: { v: 'Rate', b: true }, D4: { v: 'Amount', b: true },
      A5: { v: 'Design work' }, B5: { v: '10' }, C5: { v: '90' }, D5: { f: '=B5*C5' },
      A6: { v: 'Development' }, B6: { v: '20' }, C6: { v: '120' }, D6: { f: '=B6*C6' },
      C8: { v: 'Subtotal', b: true }, D8: { f: '=SUM(D5:D6)' },
      C9: { v: 'Tax 10%' }, D9: { f: '=D8*0.1' },
      C10: { v: 'Total', b: true }, D10: { f: '=D8+D9', b: true },
    }),
  },
  {
    id: 'sheet-gradebook', name: 'Gradebook', kind: 'sheet', category: 'education',
    description: 'Scores with average and highest.',
    build: () => sheet({
      A1: { v: 'Student', b: true }, B1: { v: 'Quiz', b: true }, C1: { v: 'Exam', b: true }, D1: { v: 'Average', b: true },
      A2: { v: 'Ada' }, B2: { v: '9' }, C2: { v: '8' }, D2: { f: '=AVERAGE(B2:C2)' },
      A3: { v: 'Linus' }, B3: { v: '7' }, C3: { v: '9' }, D3: { f: '=AVERAGE(B3:C3)' },
      A4: { v: 'Grace' }, B4: { v: '10' }, C4: { v: '10' }, D4: { f: '=AVERAGE(B4:C4)' },
      A6: { v: 'Class average', b: true }, B6: { f: '=AVERAGE(D2:D4)' },
    }),
  },
  {
    id: 'sheet-habits', name: 'Habit tracker', kind: 'sheet', category: 'personal',
    description: 'Weekly checkmarks with totals.',
    build: () => sheet({
      A1: { v: 'Habit', b: true }, B1: { v: 'Mon', b: true }, C1: { v: 'Tue', b: true }, D1: { v: 'Wed', b: true },
      E1: { v: 'Thu', b: true }, F1: { v: 'Fri', b: true }, G1: { v: 'Done', b: true },
      A2: { v: 'Walk' }, G2: { f: '=COUNT(B2:F2)' },
      A3: { v: 'Read' }, G3: { f: '=COUNT(B3:F3)' },
      A4: { v: 'Journal' }, G4: { f: '=COUNT(B4:F4)' },
    }),
  },

  // ---------------- presentations ----------------
  {
    id: 'deck-blank', name: 'Blank slide', kind: 'deck', category: 'blank',
    description: 'One empty 16:9 slide.',
    build: () => deck([{ elements: [] }]),
  },
  {
    id: 'deck-pitch', name: 'Pitch deck', kind: 'deck', category: 'business',
    description: 'Problem, solution, market, ask.',
    build: () => deck([
      { elements: [text('e1', 90, 220, 1100, 120, 'Your company', { size: 72, bold: true }), text('e2', 96, 360, 900, 60, 'One line that explains the product.', { size: 30, color: '#a1a1aa' }), rect('e3', 96, 460, 120, 6)] },
      { elements: [text('e4', 90, 90, 900, 70, 'The problem', { size: 44, bold: true }), text('e5', 96, 200, 1000, 300, '• Who has it\n• Why it hurts\n• What it costs them', { size: 28 })] },
      { elements: [text('e6', 90, 90, 900, 70, 'The solution', { size: 44, bold: true }), text('e7', 96, 200, 1000, 300, 'Describe the product in three bullets.\nAdd a screenshot on the right.', { size: 28 })] },
      { notes: 'Close with the ask and next steps.', elements: [text('e8', 90, 260, 1100, 120, 'Thank you', { size: 64, bold: true }), text('e9', 96, 390, 900, 60, 'hello@example.com', { size: 26, color: '#a1a1aa' })] },
    ]),
  },
  {
    id: 'deck-lesson', name: 'Lesson plan', kind: 'deck', category: 'education',
    description: 'Objectives, activity, recap.',
    build: () => deck([
      { elements: [text('e1', 90, 240, 1100, 110, 'Lesson title', { size: 64, bold: true }), text('e2', 96, 370, 900, 60, 'Course · Teacher · Date', { size: 26, color: '#a1a1aa' })] },
      { elements: [text('e3', 90, 90, 900, 70, 'Objectives', { size: 44, bold: true }), text('e4', 96, 200, 1000, 320, '1. …\n2. …\n3. …', { size: 30 })] },
      { notes: '15 minutes, groups of three.', elements: [text('e5', 90, 90, 900, 70, 'Activity', { size: 44, bold: true }), text('e6', 96, 200, 1000, 320, 'Explain the exercise here.', { size: 28 })] },
    ]),
  },
  {
    id: 'deck-photos', name: 'Photo story', kind: 'deck', category: 'personal',
    description: 'Large image slides with captions.',
    build: () => deck([
      { elements: [rect('e1', 0, 0, 1280, 720, '#1f2937'), text('e2', 100, 560, 1080, 80, 'A story in pictures', { size: 48, bold: true })] },
      { elements: [rect('e3', 0, 0, 1280, 720, '#111827'), text('e4', 100, 110, 900, 80, 'Chapter one', { size: 44, bold: true }), text('e5', 100, 220, 800, 120, 'Caption for this photo.', { size: 28, color: '#a1a1aa' })] },
    ]),
  },

  // ---------------- PDFs ----------------
  {
    id: 'pdf-blank', name: 'Blank PDF', kind: 'pdf', category: 'blank',
    description: 'An empty A4 page ready for notes and signatures.',
  },
  {
    id: 'pdf-letter-lines', name: 'Ruled notes', kind: 'pdf', category: 'personal',
    description: 'US Letter page with ruled lines and a date.',
  },
  {
    id: 'pdf-cover', name: 'Cover page', kind: 'pdf', category: 'business',
    description: 'A4 cover with an accent band, title and prepared-by block.',
  },
  {
    id: 'pdf-checklist', name: 'Checklist', kind: 'pdf', category: 'business',
    description: 'A4 checklist with five boxed items.',
  },

  // ---------------- whiteboards ----------------
  {
    id: 'board-blank', name: 'Blank board', kind: 'board', category: 'blank',
    description: 'Empty infinite canvas.',
    build: () => ({ elements: [], view: { x: 40, y: 40, zoom: 1 } }),
  },
  {
    id: 'board-brainstorm', name: 'Brainstorm', kind: 'board', category: 'business',
    description: 'Sticky notes around a topic.',
    build: () => ({
      elements: [
        { id: 'b1', type: 'sticky', x: 420, y: 200, w: 200, h: 150, text: 'Main topic', color: '#e11d48' },
        { id: 'b2', type: 'sticky', x: 140, y: 80, w: 200, h: 140, text: 'Idea one', color: '#fde68a' },
        { id: 'b3', type: 'sticky', x: 700, y: 90, w: 200, h: 140, text: 'Idea two', color: '#bfdbfe' },
        { id: 'b4', type: 'sticky', x: 160, y: 400, w: 200, h: 140, text: 'Idea three', color: '#bbf7d0' },
      ],
      view: { x: 120, y: 80, zoom: 1 },
    }),
  },
  {
    id: 'board-kanban', name: 'Kanban', kind: 'board', category: 'business',
    description: 'To do, doing, done columns.',
    build: () => ({
      elements: [
        { id: 'k1', type: 'rect', x: 80, y: 80, w: 300, h: 520, color: '#27272a' },
        { id: 'k2', type: 'rect', x: 420, y: 80, w: 300, h: 520, color: '#27272a' },
        { id: 'k3', type: 'rect', x: 760, y: 80, w: 300, h: 520, color: '#27272a' },
        { id: 'k4', type: 'text', x: 100, y: 100, w: 260, h: 40, text: 'To do', color: '#f4f4f5', size: 22 },
        { id: 'k5', type: 'text', x: 440, y: 100, w: 260, h: 40, text: 'Doing', color: '#f4f4f5', size: 22 },
        { id: 'k6', type: 'text', x: 780, y: 100, w: 260, h: 40, text: 'Done', color: '#f4f4f5', size: 22 },
      ],
      view: { x: 0, y: 0, zoom: 1 },
    }),
  },
  {
    id: 'board-retro', name: 'Retrospective', kind: 'board', category: 'education',
    description: 'What worked, what did not.',
    build: () => ({
      elements: [
        { id: 'r1', type: 'text', x: 120, y: 80, w: 320, h: 40, text: 'What worked', color: '#4ade80', size: 24 },
        { id: 'r2', type: 'text', x: 560, y: 80, w: 320, h: 40, text: 'What did not', color: '#fb7185', size: 24 },
        { id: 'r3', type: 'sticky', x: 120, y: 150, w: 200, h: 140, text: '', color: '#bbf7d0' },
        { id: 'r4', type: 'sticky', x: 560, y: 150, w: 200, h: 140, text: '', color: '#fecdd3' },
      ],
      view: { x: 80, y: 60, zoom: 1 },
    }),
  },

  // ---------------- code ----------------
  {
    id: 'code-js', name: 'JavaScript file', kind: 'code', category: 'blank',
    description: 'Single modern JS file.',
    build: () => code([{ name: 'index.js', language: 'javascript', text: "export function hello(name = 'world') {\n  return `hello ${name}`;\n}\n\nconsole.log(hello());\n" }]),
  },
  {
    id: 'code-html', name: 'HTML page', kind: 'code', category: 'education',
    description: 'Starter page with CSS and JS tabs.',
    build: () => code([
      { name: 'index.html', language: 'html', text: '<!doctype html>\n<html>\n  <head>\n    <link rel="stylesheet" href="style.css" />\n  </head>\n  <body>\n    <h1>Hello</h1>\n    <script src="app.js"></script>\n  </body>\n</html>\n' },
      { name: 'style.css', language: 'css', text: 'body { font-family: system-ui; margin: 40px; }\n' },
      { name: 'app.js', language: 'javascript', text: "console.log('ready');\n" },
    ]),
  },
  {
    id: 'code-python', name: 'Python script', kind: 'code', category: 'education',
    description: 'Small script with a main guard.',
    build: () => code([{ name: 'main.py', language: 'python', text: 'def main():\n    print("hello")\n\n\nif __name__ == "__main__":\n    main()\n' }]),
  },
  {
    id: 'code-json', name: 'JSON config', kind: 'code', category: 'personal',
    description: 'Well-formed config starter.',
    build: () => code([{ name: 'config.json', language: 'json', text: '{\n  "name": "cascade-project",\n  "version": "1.0.0",\n  "private": true\n}\n' }]),
  },

  // ---------------- websites ----------------
  {
    id: 'site-saas', name: 'SaaS landing page', kind: 'site', category: 'business',
    description: 'Hero, feature grid, social proof and conversion CTA.',
    build: () => site('Northstar', [
      siteSection('nav', { brand: 'Northstar', links: [{ label: 'Product', href: '#features' }, { label: 'Pricing', href: '#pricing' }, { label: 'Contact', href: '#contact' }], ctaLabel: 'Start free', ctaHref: '#contact' }),
      siteSection('hero', { eyebrow: 'Now in public beta', title: 'Ship your best work, faster.', text: 'Northstar gives product teams one calm place to plan, build and launch. No busywork. No tab archaeology.', ctaLabel: 'Start free', ctaHref: '#contact', secondaryLabel: 'See how it works', secondaryHref: '#features', align: 'left', image: '', style: { paddingY: 110, bg: 'gradient' } }),
      siteSection('logos', { title: 'Trusted by teams who care about the details', items: ['Acme', 'Monogram', 'Northwind', 'Vertex', 'Kepler'] }),
      siteSection('features', { title: 'Everything your next launch needs', text: 'A focused toolkit, designed to get out of your way.', items: [
        { title: 'One source of truth', text: 'Plans, specs and decisions live together — searchable and always current.' },
        { title: 'Fast by default', text: 'Everything is keyboard-first and responds instantly, even on slow connections.' },
        { title: 'Built to share', text: 'Invite clients and teammates with exactly the access they need.' },
        { title: 'Automatic history', text: 'Every save is versioned. Roll back a bad afternoon in two clicks.' },
        { title: 'Works offline', text: 'Keep editing when the network drops; changes merge when you reconnect.' },
        { title: 'Your data, yours', text: 'Self-host on your own terms with a clean, portable export whenever you want.' },
      ], style: { paddingY: 90 } }),
      siteSection('testimonials', { title: 'Teams do their clearest work here', items: [
        { quote: 'We replaced four tools in a week. The team actually uses it.', name: 'Maya Chen', role: 'Head of Product, Vertex' },
        { quote: 'The first planning tool that feels faster than a whiteboard.', name: 'Jon Bell', role: 'Founder, Monogram' },
      ] }),
      siteSection('cta', { title: 'Start with a clearer week.', text: 'Free for small teams. No credit card, no setup calls.', ctaLabel: 'Create your workspace', ctaHref: '#contact' }),
      siteSection('contact', { title: 'Talk to us', text: 'Tell us what you are building. We reply within two working days.', email: 'hello@example.com' }),
      siteSection('footer', { text: '© Your company. Built with Cascade.', links: [{ label: 'Privacy', href: '#' }, { label: 'Terms', href: '#' }] }),
    ], { accent: '#e11d48', bg: '#09090e', surface: '#15151d', text: '#f8f8fa', muted: '#a6a6b3' }, { title: 'Northstar — Ship your best work', description: 'One calm place for product teams to plan, build and launch.' }),
  },
  {
    id: 'site-studio', name: 'Design studio', kind: 'site', category: 'business',
    description: 'Editorial hero, selected work and a strong contact section.',
    build: () => site('Atelier', [
      siteSection('nav', { brand: 'Atelier', links: [{ label: 'Work', href: '#work' }, { label: 'Studio', href: '#about' }, { label: 'Contact', href: '#contact' }], ctaLabel: 'Start a project', ctaHref: '#contact' }),
      siteSection('hero', { eyebrow: 'Independent design studio', title: 'Brands with a point of view.', text: 'We make identities, websites and campaigns for ambitious teams. Small by design, involved from first sketch to final ship.', ctaLabel: 'See selected work', ctaHref: '#work', secondaryLabel: 'About the studio', secondaryHref: '#about', align: 'left', style: { paddingY: 120, bg: 'plain' } }),
      siteSection('gallery', { title: 'Selected work', text: 'A few recent projects. More on request.', images: [], style: { paddingY: 84 } }),
      siteSection('about', { title: 'A small studio with a long attention span.', text: 'We work with a handful of clients at a time. That means senior people on every project, no handoffs, and work that gets better because we stayed long enough to make it better.', image: '', reverse: false, style: { paddingY: 92 } }),
      siteSection('testimonials', { title: 'What clients say', items: [{ quote: 'They found the idea we had been circling for years.', name: 'Elena Rossi', role: 'Founder, Aperture' }] }),
      siteSection('cta', { title: 'Have something worth making?', text: 'Tell us about the project. We will reply with honest thoughts and next steps.', ctaLabel: 'Start a conversation', ctaHref: '#contact' }),
      siteSection('contact', { title: 'Get in touch', text: 'New business, collaborations, or a note about the work.', email: 'studio@example.com' }),
      siteSection('footer', { text: 'Atelier Studio. All rights reserved.', links: [{ label: 'Instagram', href: '#' }, { label: 'LinkedIn', href: '#' }] }),
    ], { accent: '#f97316', bg: '#0b0a09', surface: '#171411', text: '#faf7f2', muted: '#b0a89e', font: 'Georgia', radius: 4 }, { title: 'Atelier — Independent design studio', description: 'Brand, web and campaign design for ambitious teams.' }),
  },
  {
    id: 'site-portfolio', name: 'Personal portfolio', kind: 'site', category: 'personal',
    description: 'Minimal personal site with work, about and contact.',
    build: () => site('Alex Rivera', [
      siteSection('nav', { brand: 'Alex Rivera', links: [{ label: 'Work', href: '#work' }, { label: 'About', href: '#about' }, { label: 'Contact', href: '#contact' }], ctaLabel: 'Email me', ctaHref: 'mailto:hello@example.com' }),
      siteSection('hero', { eyebrow: 'Product designer · San Francisco', title: 'I design calm interfaces for complicated products.', text: 'Currently designing developer tools. Previously at independent studios and a few very small startups.', ctaLabel: 'View work', ctaHref: '#work', secondaryLabel: 'Download CV', secondaryHref: '#', align: 'left', style: { paddingY: 100 } }),
      siteSection('gallery', { title: 'Selected projects', text: 'Product design, design systems and the occasional website.', images: [], style: { paddingY: 78 } }),
      siteSection('about', { title: 'About', text: 'I have spent a decade making software feel simpler. My favourite projects sit where research, interaction design and engineering meet. When I am not working, I am probably cooking or riding a bike too far from home.', image: '', style: { paddingY: 84 } }),
      siteSection('contact', { title: 'Let’s work together', text: 'I am open to select freelance projects and full-time roles.', email: 'hello@example.com' }),
      siteSection('footer', { text: '© Alex Rivera.', links: [{ label: 'LinkedIn', href: '#' }, { label: 'Read.cv', href: '#' }] }),
    ], { accent: '#22d3ee', bg: '#08090b', surface: '#12151a', text: '#f2f5f7', muted: '#94a3b8', font: 'Inter', radius: 10 }, { title: 'Alex Rivera — Product designer', description: 'Product designer focused on calm interfaces for complicated products.' }),
  },
  {
    id: 'site-event', name: 'Event page', kind: 'site', category: 'personal',
    description: 'Conference landing page with schedule and registration.',
    build: () => site('Field Notes', [
      siteSection('nav', { brand: 'Field Notes', links: [{ label: 'Programme', href: '#programme' }, { label: 'Venue', href: '#venue' }, { label: 'Register', href: '#contact' }], ctaLabel: 'Get tickets', ctaHref: '#contact' }),
      siteSection('hero', { eyebrow: 'June 12–14 · Lisbon', title: 'Three days for people who make things.', text: 'A small conference about craft, tools and the strange paths between an idea and the thing itself.', ctaLabel: 'Get tickets', ctaHref: '#contact', secondaryLabel: 'See programme', secondaryHref: '#programme', align: 'center', style: { paddingY: 118, bg: 'gradient' } }),
      siteSection('features', { title: 'Programme', text: 'Single track, long breaks, real conversations.', items: [
        { title: 'Day one — Make', text: 'Workshops on prototyping, writing and building small tools.' },
        { title: 'Day two — Share', text: 'Talks from designers, engineers and independent makers.' },
        { title: 'Day three — Walk', text: 'A slow day of studio visits and conversations around the city.' },
      ], style: { paddingY: 88 } }),
      siteSection('testimonials', { title: 'From last year', items: [{ quote: 'The rare conference where the hallway track is as good as the programme.', name: 'Sam Okafor', role: 'Attendee' }] }),
      siteSection('cta', { title: 'Doors open at 9.', text: 'Tickets include all three days, lunch and the Friday dinner.', ctaLabel: 'Register interest', ctaHref: '#contact' }),
      siteSection('contact', { title: 'Register interest', text: 'Leave your email and we will send the ticket link first.', email: 'hello@example.com' }),
      siteSection('footer', { text: 'Field Notes is an independent event.', links: [{ label: 'Code of conduct', href: '#' }, { label: 'Accessibility', href: '#' }] }),
    ], { accent: '#facc15', bg: '#0b0b0c', surface: '#171719', text: '#fafafa', muted: '#a1a1aa', font: 'Inter', radius: 18 }, { title: 'Field Notes — A small conference', description: 'Three days for people who make things. Lisbon, June 12–14.' }),
  },
  {
    id: 'site-blog', name: 'Editorial blog', kind: 'site', category: 'blog',
    description: 'A journal-style landing page with article cards and newsletter CTA.',
    build: () => site('The Long Form', [
      siteSection('nav', { brand: 'The Long Form', links: [{ label: 'Journal', href: '#work' }, { label: 'About', href: '#about' }, { label: 'Subscribe', href: '#contact' }], ctaLabel: 'Subscribe', ctaHref: '#contact' }),
      siteSection('hero', { eyebrow: 'Notes on making things', title: 'Slow thoughts for fast times.', text: 'Essays, field notes and conversations about craft, tools and the work behind the work.', ctaLabel: 'Read the latest', ctaHref: '#work', align: 'left', style: { paddingY: 112, bg: 'gradient' } }),
      siteSection('features', { title: 'Latest stories', text: 'A living archive, updated when there is something worth saying.', items: [
        { title: 'The case for unfinished work', text: 'Why a rough draft can be more useful than a polished answer.' },
        { title: 'A studio with no walls', text: 'What changes when the place you work is a set of habits, not a room.' },
        { title: 'Tools that disappear', text: 'Good software gets out of the way. A few notes on designing for flow.' },
      ], style: { paddingY: 88 } }),
      siteSection('about', { title: 'About the journal', text: 'The Long Form is an independent publication about the practice of making things. New issues arrive twice a month, never more.', image: '', style: { paddingY: 78 } }),
      siteSection('cta', { title: 'A letter, twice a month.', text: 'No algorithms, no growth hacks. Just the next good idea.', ctaLabel: 'Subscribe', ctaHref: '#contact' }),
      siteSection('contact', { title: 'Subscribe', text: 'Leave your email and we will add you to the next issue.', email: 'letters@example.com' }),
      siteSection('footer', { text: '© The Long Form.', links: [{ label: 'Archive', href: '#work' }, { label: 'RSS', href: '#' }] }),
    ], { accent: '#f59e0b', bg: '#0c0b0a', surface: '#191612', text: '#faf7ef', muted: '#b8ad9a', font: 'Georgia', radius: 6 }, { title: 'The Long Form — Slow thoughts for fast times', description: 'An independent journal about craft, tools and the work behind the work.' }),
  },
  {
    id: 'site-commerce', name: 'Commerce launch', kind: 'site', category: 'ecommerce',
    description: 'Product launch page with benefits, gallery and conversion flow.',
    build: () => site('Field Supply', [
      siteSection('nav', { brand: 'Field Supply', links: [{ label: 'Shop', href: '#work' }, { label: 'Story', href: '#about' }, { label: 'Contact', href: '#contact' }], ctaLabel: 'Shop the drop', ctaHref: '#work' }),
      siteSection('hero', { eyebrow: 'Small batch · Made to last', title: 'Tools for the long way around.', text: 'Everyday objects designed with fewer parts, better materials and a repair-first mindset.', ctaLabel: 'Shop the collection', ctaHref: '#work', secondaryLabel: 'Our story', secondaryHref: '#about', align: 'left', image: '', style: { paddingY: 116, bg: 'gradient' } }),
      siteSection('logos', { title: 'As seen in', items: ['Field Journal', 'Good Goods', 'The Makers', 'Slow Daily'] }),
      siteSection('features', { title: 'Built to be used', text: 'Three principles behind every object we make.', items: [
        { title: 'Repairable by design', text: 'Fasteners, not glue. Replacement parts available for every product.' },
        { title: 'Honest materials', text: 'Solid brass, oiled canvas and responsibly sourced timber. Nothing pretending.' },
        { title: 'Made in small runs', text: 'We produce what we can stand behind, then make it again when it is right.' },
      ], style: { paddingY: 90 } }),
      siteSection('gallery', { title: 'The collection', text: 'A first look at the objects in this release.', images: [], style: { paddingY: 84 } }),
      siteSection('testimonials', { title: 'From the workshop', items: [{ quote: 'The kind of object you notice every day because it keeps working.', name: 'Rae Kim', role: 'Field Supply customer' }] }),
      siteSection('cta', { title: 'The next drop is small.', text: 'Join the list for first access and occasional notes from the workshop.', ctaLabel: 'Join the list', ctaHref: '#contact' }),
      siteSection('contact', { title: 'Get first access', text: 'Leave your email and we will send the next release notes.', email: 'hello@example.com' }),
      siteSection('footer', { text: '© Field Supply.', links: [{ label: 'Shipping', href: '#' }, { label: 'Repairs', href: '#' }] }),
    ], { accent: '#65a30d', bg: '#0a0d09', surface: '#151b14', text: '#f4f8ef', muted: '#a9b5a1', font: 'Inter', radius: 2 }, { title: 'Field Supply — Tools for the long way around', description: 'Small-batch, repairable everyday objects.' }),
  },
  {
    id: 'site-business', name: 'Service business', kind: 'site', category: 'business',
    description: 'Clear offer, proof, process and contact flow for a service firm.',
    build: () => site('Northline', [
      siteSection('nav', { brand: 'Northline', links: [{ label: 'Services', href: '#features' }, { label: 'Process', href: '#about' }, { label: 'Contact', href: '#contact' }], ctaLabel: 'Book a call', ctaHref: '#contact' }),
      siteSection('hero', { eyebrow: 'Operations, untangled', title: 'Make the work flow.', text: 'Northline helps growing teams simplify the systems behind their service delivery — without a six-month transformation project.', ctaLabel: 'Book a discovery call', ctaHref: '#contact', secondaryLabel: 'How we work', secondaryHref: '#about', align: 'left', style: { paddingY: 108, bg: 'gradient' } }),
      siteSection('logos', { title: 'Trusted by operators at', items: ['Aperture', 'Monogram', 'Fieldwork', 'Hearth'] }),
      siteSection('features', { title: 'A calmer operating system', text: 'We find the bottleneck, design the fix and stay until it sticks.', items: [
        { title: 'Diagnose', text: 'A short, focused review of the handoffs, tools and decisions slowing the team down.' },
        { title: 'Design', text: 'A practical operating model your team can run without a consultant in the room.' },
        { title: 'Embed', text: 'We work alongside your leads to ship the change and leave the muscle behind.' },
      ], style: { paddingY: 88 } }),
      siteSection('about', { title: 'Small team. Senior attention.', text: 'Northline is a two-person practice with a network of specialists. Every engagement is led by the people who do the work — no handoffs, no junior slide decks.', image: '', reverse: false, style: { paddingY: 82 } }),
      siteSection('testimonials', { title: 'What leaders say', items: [{ quote: 'We stopped firefighting in a month. The team finally has room to think.', name: 'Priya Shah', role: 'COO, Hearth' }] }),
      siteSection('cta', { title: 'Ready for a calmer quarter?', text: 'Tell us where the friction is. We will reply with a short, honest read.', ctaLabel: 'Start a conversation', ctaHref: '#contact' }),
      siteSection('contact', { title: 'Book a discovery call', text: 'A 30-minute conversation, no pitch deck required.', email: 'hello@example.com' }),
      siteSection('footer', { text: '© Northline.', links: [{ label: 'Privacy', href: '#' }, { label: 'Terms', href: '#' }] }),
    ], { accent: '#0ea5e9', bg: '#080b0f', surface: '#121a22', text: '#f1f7fb', muted: '#93a8b8', font: 'Inter', radius: 12 }, { title: 'Northline — Make the work flow', description: 'Operations consulting for growing service teams.' }),
  },
  {
    id: 'roblox-starter', name: 'Roblox place', kind: 'roblox', category: 'game',
    description: 'Starter place with Workspace, scripts and a ScreenGui HUD.',
    build: () => roblox('Untitled Roblox place'),
  },
  {
    id: 'roblox-blank', name: 'Blank Roblox place', kind: 'roblox', category: 'blank',
    description: 'An empty place ready for the Studio relay.',
    build: () => roblox('Blank Roblox place', true),
  },
  {
    id: 'site-blank', name: 'Blank website', kind: 'site', category: 'blank',
    description: 'Start a page from a clean canvas.',
    build: () => site('Your brand', [
      siteSection('nav', { brand: 'Your brand', links: [{ label: 'Home', href: '#' }, { label: 'About', href: '#about' }, { label: 'Contact', href: '#contact' }], ctaLabel: 'Get in touch', ctaHref: '#contact' }),
      siteSection('hero', { eyebrow: '', title: 'A clear, confident headline.', text: 'One short paragraph that explains what you do and who it is for.', ctaLabel: 'Get started', ctaHref: '#contact', align: 'left', style: { paddingY: 110 } }),
      siteSection('footer', { text: '© Your brand.', links: [] }),
    ]),
  },

  // ---------------- forms ----------------
  {
    id: 'form-blank', name: 'Blank form', kind: 'form', category: 'blank',
    description: 'One short-answer question.',
    build: () => form('Untitled form', 'Add a description for respondents.', [field('q1', 'text', 'Your answer', { required: true })]),
  },
  {
    id: 'form-contact', name: 'Contact form', kind: 'form', category: 'business',
    description: 'Name, email and message.',
    build: () => form('Contact us', 'We usually reply within two working days.', [
      field('q1', 'text', 'Name', { required: true }),
      field('q2', 'email', 'Email', { required: true }),
      field('q3', 'textarea', 'How can we help?', { required: true }),
    ]),
  },
  {
    id: 'form-rsvp', name: 'Event RSVP', kind: 'form', category: 'personal',
    description: 'Attendance and guest count.',
    build: () => form('Event RSVP', 'Let us know if you can make it.', [
      field('q1', 'text', 'Full name', { required: true }),
      field('q2', 'select', 'Will you attend?', { required: true, options: ['Yes', 'No', 'Maybe'] }),
      field('q3', 'number', 'Guests', { help: 'Including yourself.' }),
    ]),
  },
  {
    id: 'form-survey', name: 'Feedback survey', kind: 'form', category: 'education',
    description: 'Rating, choice and comments.',
    build: () => form('Course feedback', 'Two minutes, five questions.', [
      field('q1', 'number', 'How would you rate the course? (1–5)', { required: true }),
      field('q2', 'radio', 'Pace of the sessions', { options: ['Too slow', 'Just right', 'Too fast'] }),
      field('q3', 'textarea', 'What should improve?'),
    ]),
  },
];

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

export function buildContent(templateId, kind) {
  const t = templateId ? getTemplate(templateId) : null;
  if (t) return t.build();
  const blank = TEMPLATES.find((x) => x.kind === kind && x.category === 'blank');
  return blank ? blank.build() : null;
}

export function templatesFor(kind, category) {
  return TEMPLATES.filter((t) => (!kind || t.kind === kind) && (!category || t.category === category));
}

export const KIND_BY_ID = new Map(KINDS.map((k) => [k.id, k]));
