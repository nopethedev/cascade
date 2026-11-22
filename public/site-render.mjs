/* Shared website renderer. Pure strings so the editor preview, published site,
   template gallery and exports all show exactly the same content. */

export const DEFAULT_SITE_BREAKPOINTS = Object.freeze({ tablet: 860, mobile: 600 });

export const SECTION_LABELS = {
  nav: 'Navigation', hero: 'Hero', logos: 'Logo strip', features: 'Features', about: 'About',
  gallery: 'Gallery', testimonials: 'Testimonials', cta: 'Call to action', contact: 'Contact',
  footer: 'Footer', custom: 'Custom embed', cms: 'CMS collection', freeform: 'Freeform canvas',
};

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const color = (value, fallback) => {
  const v = String(value || '');
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/i.test(v)) return v;
  if (v === 'transparent') return v;
  return fallback;
};

const href = (value) => {
  const v = String(value || '').trim();
  if (!v) return '#';
  if (/^(https?:\/\/|mailto:|tel:|#|\/)/i.test(v)) return v;
  return '#';
};

function videoSrc(src) {
  const value = String(src || '').trim();
  if (/^https?:\/\/[^\s"']+$/i.test(value)) return value;
  if (/^\/f\/[A-Za-z0-9_-]+\/raw$/.test(value)) return value;
  if (/^\/sites\/[A-Za-z0-9_-]+\/asset\/[A-Za-z0-9_-]+$/.test(value)) return value;
  return '';
}

function imageSrc(src, opts) {
  const value = String(src || '');
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(value)) return value;
  const local = /^\/f\/([A-Za-z0-9_-]+)\/raw$/.exec(value);
  if (local) return opts?.slug ? `/sites/${encodeURIComponent(opts.slug)}/asset/${local[1]}` : value;
  if (/^\/raw\/[A-Za-z0-9_-]+$/.test(value)) return value;
  if (/^\/sites\/[A-Za-z0-9_-]+\/asset\/[A-Za-z0-9_-]+$/.test(value)) return value;
  return '';
}

function fontStack(font) {
  const name = String(font || 'Inter');
  if (/georgia/i.test(name)) return 'Georgia, "Times New Roman", serif';
  if (/times/i.test(name)) return '"Times New Roman", Times, serif';
  if (/courier/i.test(name)) return '"Courier New", monospace';
  if (/mono/i.test(name)) return 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  if (/serif/i.test(name)) return 'Georgia, serif';
  return 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
}

export function breakpointsFor(content = {}) {
  const b = content?.theme?.breakpoints || {};
  const tablet = Math.max(480, Math.min(1200, num(b.tablet, DEFAULT_SITE_BREAKPOINTS.tablet)));
  const mobile = Math.max(320, Math.min(tablet - 1, num(b.mobile, DEFAULT_SITE_BREAKPOINTS.mobile)));
  return { tablet, mobile };
}

function layoutFor(section) {
  const defaults = section.type === 'gallery' ? { columns: 2, tablet: 2, mobile: 1 } : { columns: 3, tablet: 2, mobile: 1 };
  const l = section.layout && typeof section.layout === 'object' ? section.layout : {};
  return {
    display: l.display === 'flex' ? 'flex' : 'grid',
    columns: Math.max(1, Math.min(6, num(l.columns, defaults.columns))),
    tablet: Math.max(1, Math.min(4, num(l.tablet, defaults.tablet))),
    mobile: Math.max(1, Math.min(2, num(l.mobile, defaults.mobile))),
    gap: Math.max(0, Math.min(72, num(l.gap, 14))),
    align: ['stretch', 'start', 'center', 'end'].includes(l.align) ? l.align : 'stretch',
    justify: ['start', 'center', 'end', 'space-between'].includes(l.justify) ? l.justify : 'start',
  };
}

function responsiveSectionCss(content, bp) {
  const rules = { tablet: [], mobile: [] };
  for (const section of content?.sections || []) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(section?.id || ''))) continue;
    const s = section.style || {};
    const selector = `[data-cs-id="${section.id}"]`;
    if (s.hideTablet) rules.tablet.push(`${selector}{display:none}`);
    if (s.hideMobile) rules.mobile.push(`${selector}{display:none}`);
    if (s.paddingYTablet !== undefined) rules.tablet.push(`${selector}{padding-top:${Math.max(0, Math.min(260, num(s.paddingYTablet, 80)))}px;padding-bottom:${Math.max(0, Math.min(260, num(s.paddingYTablet, 80)))}px}`);
    if (s.paddingYMobile !== undefined) rules.mobile.push(`${selector}{padding-top:${Math.max(0, Math.min(260, num(s.paddingYMobile, 80)))}px;padding-bottom:${Math.max(0, Math.min(260, num(s.paddingYMobile, 80)))}px}`);
  }
  const tablet = rules.tablet.length ? `@media (max-width:${bp.tablet}px){${rules.tablet.join('')}}` : '';
  const mobile = rules.mobile.length ? `@media (max-width:${bp.mobile}px){${rules.mobile.join('')}}` : '';
  return `${tablet}\n${mobile}`;
}

export function sectionLayoutStyle(section) {
  const l = layoutFor(section);
  return `--cs-layout:${l.display};--cs-cols:${l.columns};--cs-cols-tablet:${l.tablet};--cs-cols-mobile:${l.mobile};--cs-gap:${l.gap}px;--cs-align:${l.align};--cs-justify:${l.justify}`;
}

function sectionStyle(section, theme) {
  const s = section.style || {};
  const bg = s.bg === 'gradient'
    ? `linear-gradient(135deg, ${color(s.bgFrom, color(theme.surface, '#14141b'))} 0%, ${color(s.bgTo, color(theme.bg, '#0b0b10'))} 64%)`
    : s.bg === 'custom' ? color(s.bgColor, 'transparent') : s.bg && s.bg !== 'plain' ? color(s.bg, 'transparent') : '';
  const styles = [];
  if (bg) styles.push(`background:${bg}`);
  if (s.bgImage) {
    const image = imageSrc(s.bgImage, {});
    if (image) styles.push(`background-image:linear-gradient(color-mix(in srgb,${color(theme.bg, '#0b0b10')} 48%,transparent),color-mix(in srgb,${color(theme.bg, '#0b0b10')} 78%,transparent)),url("${image.replace(/["\\]/g, '')}")`, 'background-size:cover', 'background-position:center');
  }
  styles.push(`padding-top:${Math.max(0, Math.min(260, num(s.paddingY, 80)))}px`);
  styles.push(`padding-bottom:${Math.max(0, Math.min(260, num(s.paddingY, 80)))}px`);
  if (s.color) styles.push(`color:${color(s.color, theme.text)}`);
  if (s.align) styles.push(`text-align:${['left', 'center', 'right'].includes(s.align) ? s.align : 'left'}`);
  if (section.animation && section.animation !== 'none') styles.push(`--cs-anim:${section.animation}`);
  return styles.join(';');
}

function sectionClass(section) {
  return `cs-section cs-${section.type}${section.style?.bgVideo ? ' cs-has-bg-video' : ''}${section.animation && section.animation !== 'none' ? ' cs-anim' : ''}`;
}

function sectionAttrs(section, opts) {
  const id = /^[A-Za-z0-9_-]{1,80}$/.test(String(section.id || '')) ? section.id : '';
  return ` data-cs-id="${esc(id)}"${opts?.preview ? ` data-section-id="${esc(section.id)}" data-section-type="${esc(section.type)}"` : ''}`;
}

function button(label, link, opts = {}) {
  if (!label) return '';
  return `<a class="cs-btn${opts.secondary ? ' cs-btn-ghost' : ''}" href="${esc(href(link))}"${opts.preview ? ' onclick="return false"' : ''}>${esc(label)}<span aria-hidden="true">→</span></a>`;
}

function nav(section, content, opts) {
  const links = (section.links || []).slice(0, 7).map((l) => `<a href="${esc(href(l.href))}"${opts?.preview ? ' onclick="return false"' : ''}>${esc(l.label)}</a>`).join('');
  return `<header class="${sectionClass(section)} cs-nav"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)}">
    <div class="cs-wrap cs-nav-in">
      <a class="cs-brand" href="#top">${esc(section.brand || content.brand || 'Brand')}</a>
      <nav class="cs-nav-links" aria-label="Main navigation">${links}</nav>
      ${section.ctaLabel ? button(section.ctaLabel, section.ctaHref, opts) : ''}
      <details class="cs-mobile-nav"><summary aria-label="Open menu">☰</summary><div>${links}${section.ctaLabel ? `<a href="${esc(href(section.ctaHref))}">${esc(section.ctaLabel)}</a>` : ''}</div></details>
    </div>
  </header>`;
}

function hero(section, content, opts) {
  const image = imageSrc(section.image, opts);
  return `<section class="${sectionClass(section)} cs-hero cs-align-${esc(section.align || 'left')}${image ? ' cs-has-image' : ''}"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)}">
    <div class="cs-wrap cs-hero-grid">
      <div class="cs-hero-copy">
        ${section.eyebrow ? `<p class="cs-eyebrow">${esc(section.eyebrow)}</p>` : ''}
        <h1>${esc(section.title || 'A clear, confident headline.')}</h1>
        ${section.text ? `<p class="cs-lede">${esc(section.text)}</p>` : ''}
        <div class="cs-actions">${button(section.ctaLabel || 'Get started', section.ctaHref, opts)}${section.secondaryLabel ? button(section.secondaryLabel, section.secondaryHref, { ...opts, secondary: true }) : ''}</div>
      </div>
      ${image ? `<figure class="cs-hero-art"><img src="${esc(image)}" alt="${esc(section.imageAlt || '')}" loading="lazy" /></figure>` : '<div class="cs-hero-art cs-art-placeholder" aria-hidden="true"><span></span><span></span><span></span><span></span></div>'}
    </div>
  </section>`;
}

function logos(section, content, opts) {
  const items = section.items || [];
  return `<section class="${sectionClass(section)} cs-logos"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)}">
    <div class="cs-wrap">
      ${section.title ? `<p class="cs-logos-title">${esc(section.title)}</p>` : ''}
      <div class="cs-logo-row">${items.map((i) => `<span>${esc(i)}</span>`).join('')}</div>
    </div>
  </section>`;
}

function features(section, content, opts) {
  const items = section.items || [];
  const layout = layoutFor(section);
  return `<section class="${sectionClass(section)} cs-features" id="features"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)}">
    <div class="cs-wrap">
      <div class="cs-section-head">
        ${section.eyebrow ? `<p class="cs-eyebrow">${esc(section.eyebrow)}</p>` : ''}
        <h2>${esc(section.title || 'What you get')}</h2>
        ${section.text ? `<p>${esc(section.text)}</p>` : ''}
      </div>
      <div class="cs-feature-grid cs-layout-${layout.display}" style="${sectionLayoutStyle(section)}">${items.map((item, i) => `<article class="cs-card">
        <span class="cs-card-no">${String(i + 1).padStart(2, '0')}</span>
        <h3>${esc(item.title || 'Feature')}</h3>
        <p>${esc(item.text || '')}</p>
      </article>`).join('')}</div>
    </div>
  </section>`;
}

function about(section, content, opts) {
  const image = imageSrc(section.image, opts);
  return `<section class="${sectionClass(section)} cs-about${section.reverse ? ' cs-reverse' : ''}" id="about"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)}">
    <div class="cs-wrap cs-about-grid">
      <div>${section.eyebrow ? `<p class="cs-eyebrow">${esc(section.eyebrow)}</p>` : ''}<h2>${esc(section.title || 'About')}</h2>${String(section.text || '').split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      ${image ? `<figure class="cs-about-art"><img src="${esc(image)}" alt="${esc(section.imageAlt || '')}" loading="lazy" /></figure>` : '<div class="cs-about-art cs-art-placeholder" aria-hidden="true"><span></span><span></span></div>'}
    </div>
  </section>`;
}

function gallery(section, content, opts) {
  const images = (section.images || []).map((img) => ({ ...img, src: imageSrc(img.src, opts) })).filter((img) => img.src);
  const fallback = (section.items || []).map((item, i) => `<article class="cs-work-card cs-work-${(i % 3) + 1}"><div class="cs-work-art"></div><div class="cs-work-meta"><strong>${esc(item.title || 'Project')}</strong><span>${esc(item.text || 'Brand · Digital')}</span></div></article>`);
  const layout = layoutFor(section);
  const gridAttrs = `class="cs-gallery-grid cs-layout-${layout.display}" style="${sectionLayoutStyle(section)}"`;
  return `<section class="${sectionClass(section)} cs-gallery" id="work"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)}">
    <div class="cs-wrap">
      <div class="cs-section-head"><h2>${esc(section.title || 'Selected work')}</h2>${section.text ? `<p>${esc(section.text)}</p>` : ''}</div>
      ${images.length ? `<div ${gridAttrs}>${images.map((img, i) => `<figure class="cs-gallery-item cs-gallery-${(i % 3) + 1}"><img src="${esc(img.src)}" alt="${esc(img.alt || '')}" loading="lazy" />${img.caption ? `<figcaption>${esc(img.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : `<div ${gridAttrs}>${fallback.length ? fallback.join('') : '<p class="cs-empty-note">Add images from the image library to build this gallery.</p>'}</div>`}
    </div>
  </section>`;
}

function testimonials(section, content, opts) {
  const items = section.items || [];
  const layout = layoutFor(section);
  return `<section class="${sectionClass(section)} cs-testimonials"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)}">
    <div class="cs-wrap">
      ${section.title ? `<div class="cs-section-head"><h2>${esc(section.title)}</h2></div>` : ''}
      <div class="cs-quote-grid cs-layout-${layout.display}" style="${sectionLayoutStyle(section)}">${items.map((t) => `<figure class="cs-quote"><blockquote>“${esc(t.quote || '')}”</blockquote><figcaption><strong>${esc(t.name || '')}</strong><span>${esc(t.role || '')}</span></figcaption></figure>`).join('')}</div>
    </div>
  </section>`;
}

function cta(section, content, opts) {
  return `<section class="${sectionClass(section)} cs-cta"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)}">
    <div class="cs-wrap"><div class="cs-cta-box">
      <h2>${esc(section.title || 'Ready to start?')}</h2>
      ${section.text ? `<p>${esc(section.text)}</p>` : ''}
      ${button(section.ctaLabel || 'Get started', section.ctaHref, opts)}
    </div></div>
  </section>`;
}

function contact(section, content, opts) {
  const action = opts?.action || '#';
  return `<section class="${sectionClass(section)} cs-contact" id="contact"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)}">
    <div class="cs-wrap cs-contact-grid">
      <div><p class="cs-eyebrow">Contact</p><h2>${esc(section.title || 'Get in touch')}</h2>${section.text ? `<p>${esc(section.text)}</p>` : ''}${section.email ? `<a class="cs-mail" href="mailto:${esc(section.email)}">${esc(section.email)}</a>` : ''}</div>
      <form class="cs-form" method="post" action="${esc(action)}"${opts?.preview ? ' onsubmit="return false"' : ''}>
        <label>Name<input name="name" autocomplete="name" required maxlength="120" /></label>
        <label>Email<input name="email" type="email" autocomplete="email" required maxlength="180" /></label>
        <label>Message<textarea name="message" rows="4" required maxlength="4000"></textarea></label>
        <input type="text" name="company" tabindex="-1" autocomplete="off" class="cs-hp" aria-hidden="true" />
        <button type="submit" class="cs-btn">Send message <span aria-hidden="true">→</span></button>
        ${opts?.submitted ? '<p class="cs-form-ok">Thanks — your message was received.</p>' : ''}
      </form>
    </div>
  </section>`;
}

function footer(section, content, opts) {
  const links = (section.links || []).map((l) => `<a href="${esc(href(l.href))}">${esc(l.label)}</a>`).join('');
  return `<footer class="${sectionClass(section)} cs-footer"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)}">
    <div class="cs-wrap cs-footer-in"><span>${esc(section.text || `© ${content.brand || 'Your brand'}`)}</span><span class="cs-footer-links">${links}</span></div>
  </footer>`;
}

function freeform(section, content, opts) {
  const items = (Array.isArray(section.items) ? section.items : []).slice(0, 40).map((item, index) => {
    const x = Math.max(0, Math.min(94, num(item.x, 8)));
    const y = Math.max(0, Math.min(94, num(item.y, 8)));
    const w = Math.max(4, Math.min(100 - x, num(item.w, 30)));
    const h = Math.max(4, Math.min(100 - y, num(item.h, 24)));
    const bg = color(item.bg, 'color-mix(in srgb,var(--cs-surface) 88%,transparent)');
    const image = imageSrc(item.image, opts);
    const kicker = item.kicker ? `<span class="cs-freeform-kicker">${esc(item.kicker)}</span>` : '';
    const body = item.text ? `<p>${esc(item.text)}</p>` : '';
    const style = `left:${x}%;top:${y}%;width:${w}%;height:${h}%;--cs-item-bg:${bg};--cs-item-fg:${color(item.color, 'var(--cs-text)')}`;
    const inner = `${image ? `<img src="${esc(image)}" alt="${esc(item.imageAlt || '')}" loading="lazy" />` : ''}<span class="cs-freeform-body">${kicker}<strong>${esc(item.title || `Block ${index + 1}`)}</strong>${body}</span>`;
    return `<div class="cs-freeform-item" data-freeform-id="${esc(item.id || index)}" style="${style}">${inner}</div>`;
  }).join('');
  return `<section class="${sectionClass(section)} cs-freeform-section"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)};--cs-freeform-height:${Math.max(260, Math.min(900, num(section.height, 460)))}px">
    <div class="cs-wrap"><div class="cs-freeform"${opts?.preview ? ' data-freeform-canvas="1"' : ''}>${items || '<p class="cs-empty-note">Add blocks in the Freeform inspector.</p>'}</div></div>
  </section>`;
}

function custom(section, content, opts) {
  const html = String(section.html || '<p>Custom HTML</p>');
  const css = String(section.css || '').replace(/<\/style/gi, '<\\/style');
  const js = String(section.js || '').replace(/<\/script/gi, '<\\/script');
  const srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui;background:${color(content.theme?.bg, '#0b0b10')};color:${color(content.theme?.text, '#f7f7f8')};padding:28px}${css}</style></head><body>${html}<script>${js}<\/script></body></html>`;
  return `<section class="${sectionClass(section)} cs-custom"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)}">
    <div class="cs-wrap"><iframe class="cs-custom-frame" sandbox="allow-scripts" title="${esc(section.title || 'Custom content')}" srcdoc="${esc(srcdoc)}"></iframe></div>
  </section>`;
}

function cmsItemHref(section, item, opts) {
  if (!opts?.slug || !section.collectionSlug || !item.slug) return '#';
  return `/sites/${encodeURIComponent(opts.slug)}/c/${encodeURIComponent(section.collectionSlug)}/${encodeURIComponent(item.slug)}`;
}

function cms(section, content, opts) {
  const items = (opts.cmsItems || []).filter((item) => item.collectionId === section.collectionId || item.collectionSlug === section.collectionSlug).slice(0, Math.max(1, Math.min(24, num(section.limit, 6))));
  const layout = layoutFor(section);
  return `<section class="${sectionClass(section)} cs-cms"${sectionAttrs(section, opts)} style="${sectionStyle(section, content.theme)}">
    <div class="cs-wrap">
      <div class="cs-section-head">${section.eyebrow ? `<p class="cs-eyebrow">${esc(section.eyebrow)}</p>` : ''}<h2>${esc(section.title || 'Latest posts')}</h2>${section.text ? `<p>${esc(section.text)}</p>` : ''}</div>
      ${items.length ? `<div class="cs-cms-grid cs-layout-${layout.display}" style="${sectionLayoutStyle(section)}">${items.map((item) => {
        const data = item.data || {};
        const title = data.title || data.name || item.slug;
        const excerpt = data.excerpt || data.description || data.summary || '';
        const image = imageSrc(data.image, opts);
        return `<article class="cs-cms-card">${image ? `<img src="${esc(image)}" alt="${esc(data.imageAlt || '')}" loading="lazy" />` : ''}<div class="cs-cms-body"><p class="cs-eyebrow">${esc(data.category || data.date || 'Story')}</p><h3><a href="${esc(cmsItemHref(section, item, opts))}"${opts?.preview ? ' onclick="return false"' : ''}>${esc(title)}</a></h3>${excerpt ? `<p>${esc(String(excerpt).slice(0, 260))}</p>` : ''}<a class="cs-cms-link" href="${esc(cmsItemHref(section, item, opts))}"${opts?.preview ? ' onclick="return false"' : ''}>Read more →</a></div></article>`;
      }).join('')}</div>` : `<div class="cs-cms-empty">No published items yet. Add content in the CMS panel of the editor.</div>`}
    </div>
  </section>`;
}

export function renderCmsItem(content, collection, item, opts = {}) {
  const data = item?.data || {};
  const fields = Array.isArray(collection?.fields) ? collection.fields : [];
  const title = data.title || data.name || item?.slug || 'Untitled';
  const bodyFields = fields.filter((f) => f.type === 'richtext' || f.type === 'text' || f.type === 'markdown');
  return `<article class="cs-cms-item">
    <p class="cs-eyebrow">${esc(collection?.name || 'Collection')}${data.date ? ` · ${esc(data.date)}` : ''}</p>
    <h1>${esc(title)}</h1>
    ${data.excerpt ? `<p class="cs-lede">${esc(data.excerpt)}</p>` : ''}
    ${imageSrc(data.image, opts) ? `<img class="cs-cms-cover" src="${esc(imageSrc(data.image, opts))}" alt="${esc(data.imageAlt || '')}" />` : ''}
    <div class="cs-cms-copy">${bodyFields.map((f) => {
      const value = data[f.id];
      if (value === undefined || value === null || value === '') return '';
      if (f.type === 'text') return `<h2>${esc(value)}</h2>`;
      return String(value).split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    }).join('') || '<p>This item has no body yet.</p>'}</div>
    <a class="cs-btn" href="/sites/${esc(opts.slug || '')}">← Back to ${esc(content?.brand || 'site')}</a>
  </article>`;
}

export function renderSection(section, content, opts = {}) {
  if (!section || !section.type) return '';
  const map = { nav, hero, logos, features, about, gallery, testimonials, cta, contact, footer, custom, cms, freeform };
  let html = (map[section.type] || (() => ''))(section, content, opts);
  const video = videoSrc(section?.style?.bgVideo);
  if (video && html) {
    // Insert the video immediately inside the section root so it can cover the
    // section without disturbing the renderer's child markup.
    const tag = html.startsWith('<footer') ? 'footer' : 'section';
    html = html.replace(new RegExp(`<${tag}([^>]*)>`), `<${tag}$1><video class="cs-bg-video" autoplay muted loop playsinline preload="metadata" src="${esc(video)}"></video>`);
  }
  return html;
}

export function renderSiteBody(content, opts = {}) {
  const sections = Array.isArray(content?.sections) ? content.sections : [];
  let html = `<div class="cs-site" id="top">${sections.map((s) => renderSection(s, content, opts)).join('\n')}</div>`;
  if (opts.item) {
    const navEnd = html.indexOf('</header>');
    const article = renderCmsItem(content, opts.collection, opts.item, opts);
    html = navEnd >= 0 ? html.slice(0, navEnd + 9) + article + html.slice(navEnd + 9) : article + html;
  }
  return html;
}

export function siteCss(content = {}) {
  const t = { ...(content.theme || {}) };
  const accent = color(t.accent, '#e11d48');
  const bg = color(t.bg, '#0b0b10');
  const surface = color(t.surface, '#14141b');
  const text = color(t.text, '#f7f7f8');
  const muted = color(t.muted, '#a1a1aa');
  const radius = Math.max(0, Math.min(40, num(t.radius, 14)));
  const max = Math.max(720, Math.min(1440, num(t.maxWidth, 1120)));
  const bp = breakpointsFor(content);
  return `
:root,.cs-site{--cs-accent:${accent};--cs-bg:${bg};--cs-surface:${surface};--cs-text:${text};--cs-muted:${muted};--cs-line:color-mix(in srgb,var(--cs-text) 14%,var(--cs-bg));--cs-radius:${radius}px;--cs-max:${max}px;--cs-font:${fontStack(t.font)};--cs-heading-font:${fontStack(t.headingFont || t.font)};color-scheme:dark}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:${bg};color:${text};font-family:${fontStack(t.font)};-webkit-font-smoothing:antialiased;line-height:1.55}
.cs-site{overflow:hidden;container-type:inline-size}a{color:inherit;text-decoration:none}img{display:block;max-width:100%}h1,h2,h3,p,figure,blockquote{margin:0}
.cs-wrap{width:100%;max-width:var(--cs-max);margin:0 auto;padding:0 clamp(20px,5vw,48px)}
.cs-section{position:relative}.cs-eyebrow{font:700 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.17em;text-transform:uppercase;color:var(--cs-accent);margin-bottom:14px}
.cs-section h2{font-family:var(--cs-heading-font);font-size:clamp(28px,4.2vw,46px);line-height:1.08;letter-spacing:-.045em;font-weight:650;max-width:660px}
.cs-section-head{max-width:720px;margin-bottom:38px}.cs-section-head p{color:var(--cs-muted);font-size:clamp(14px,1.4vw,16px);margin-top:12px;max-width:58ch}
.cs-btn{display:inline-flex;align-items:center;gap:9px;min-height:42px;padding:0 17px;background:var(--cs-accent);color:#fff;border-radius:calc(var(--cs-radius) * .55);font:600 13px/1 var(--cs-font);border:1px solid transparent;cursor:pointer}
.cs-btn span{transition:transform .15s}.cs-btn:hover span{transform:translateX(3px)}.cs-btn-ghost{background:transparent;color:var(--cs-text);border-color:var(--cs-line)}
.cs-nav{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--cs-bg) 82%,transparent);backdrop-filter:blur(14px) saturate(140%);border-bottom:1px solid var(--cs-line);padding:0}
.cs-nav-in{display:flex;align-items:center;gap:28px;min-height:66px}.cs-brand{font-weight:700;font-size:16px;letter-spacing:-.03em;white-space:nowrap}
.cs-nav-links{display:flex;align-items:center;gap:22px;margin-left:auto;font-size:13px;color:var(--cs-muted)}.cs-nav-links a:hover{color:var(--cs-text)}
.cs-nav .cs-btn{min-height:34px;padding:0 13px;font-size:12px}.cs-mobile-nav{display:none;margin-left:auto;position:relative}.cs-mobile-nav summary{list-style:none;font-size:20px;cursor:pointer;padding:6px}.cs-mobile-nav summary::-webkit-details-marker{display:none}.cs-mobile-nav>div{position:absolute;right:0;top:calc(100% + 8px);min-width:180px;padding:8px;background:var(--cs-surface);border:1px solid var(--cs-line);border-radius:10px;display:grid;gap:2px;box-shadow:0 18px 50px rgba(0,0,0,.45)}.cs-mobile-nav>div a{padding:8px 10px;border-radius:6px;font-size:13px}.cs-mobile-nav>div a:hover{background:color-mix(in srgb,var(--cs-text) 7%,transparent)}
.cs-hero{padding:clamp(66px,9vw,120px) 0;border-bottom:1px solid var(--cs-line)}.cs-hero-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(300px,.85fr);gap:clamp(30px,6vw,76px);align-items:center}.cs-hero-copy{max-width:760px}.cs-hero h1{font-size:clamp(42px,7.2vw,82px);line-height:.98;letter-spacing:-.058em;font-weight:650;max-width:13ch}.cs-lede{color:var(--cs-muted);font-size:clamp(15px,1.7vw,19px);line-height:1.6;max-width:56ch;margin-top:22px}.cs-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:32px}.cs-align-center .cs-hero-copy{margin:0 auto;text-align:center}.cs-align-center .cs-hero h1{margin:0 auto}.cs-align-center .cs-lede{margin-left:auto;margin-right:auto}.cs-align-center .cs-actions{justify-content:center}.cs-align-center .cs-hero-grid{grid-template-columns:minmax(0,1fr)}.cs-align-center .cs-hero-art{display:none}
.cs-hero-art{border-radius:calc(var(--cs-radius) * 1.4);overflow:hidden;background:var(--cs-surface);border:1px solid var(--cs-line);aspect-ratio:4/3}.cs-hero-art img{width:100%;height:100%;object-fit:cover}
.cs-art-placeholder{position:relative;background:linear-gradient(145deg,color-mix(in srgb,var(--cs-accent) 15%,var(--cs-surface)),var(--cs-surface) 55%,color-mix(in srgb,var(--cs-accent) 8%,var(--cs-bg)));overflow:hidden}.cs-art-placeholder span{position:absolute;border:1px solid color-mix(in srgb,var(--cs-text) 16%,transparent);background:color-mix(in srgb,var(--cs-text) 6%,transparent);border-radius:calc(var(--cs-radius) * .7);backdrop-filter:blur(6px)}.cs-art-placeholder span:nth-child(1){left:12%;top:14%;width:54%;height:29%}.cs-art-placeholder span:nth-child(2){right:8%;top:20%;width:22%;height:17%;background:var(--cs-accent);border-color:transparent}.cs-art-placeholder span:nth-child(3){left:20%;bottom:13%;width:62%;height:31%}.cs-art-placeholder span:nth-child(4){right:16%;bottom:19%;width:11%;height:11%;border-radius:50%}
.cs-logos{padding:30px 0!important;border-bottom:1px solid var(--cs-line)}.cs-logos-title{text-align:center;color:var(--cs-muted);font-size:11px;text-transform:uppercase;letter-spacing:.13em;margin-bottom:16px}.cs-logo-row{display:flex;align-items:center;justify-content:center;gap:clamp(22px,5vw,58px);flex-wrap:wrap}.cs-logo-row span{font-weight:650;font-size:clamp(15px,2vw,21px);letter-spacing:-.04em;color:color-mix(in srgb,var(--cs-text) 48%,var(--cs-bg))}
.cs-feature-grid{display:grid;grid-template-columns:repeat(var(--cs-cols,3),minmax(0,1fr));gap:var(--cs-gap,12px)}
.cs-layout-flex{display:flex!important;flex-wrap:wrap;align-items:var(--cs-align,stretch);justify-content:var(--cs-justify,start)}
.cs-layout-flex>.cs-card,.cs-layout-flex>.cs-quote,.cs-layout-flex>.cs-work-card,.cs-layout-flex>.cs-gallery-item,.cs-layout-flex>.cs-cms-card{flex:1 1 min(260px,100%)}
.cs-bg-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.30;z-index:0;pointer-events:none}.cs-has-bg-video>*{position:relative;z-index:1}.cs-card{border:1px solid var(--cs-line);border-radius:var(--cs-radius);padding:22px;background:color-mix(in srgb,var(--cs-surface) 72%,transparent);min-height:170px;display:flex;flex-direction:column;justify-content:space-between;gap:22px}.cs-card-no{font:600 10px/1 ui-monospace,monospace;color:var(--cs-accent);letter-spacing:.1em}.cs-card h3{font-size:17px;letter-spacing:-.025em;font-weight:600}.cs-card p{color:var(--cs-muted);font-size:13.5px;line-height:1.55;margin-top:7px}
.cs-about-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.85fr);gap:clamp(30px,6vw,76px);align-items:center}.cs-about h2{margin-bottom:20px}.cs-about p{color:var(--cs-muted);margin-top:12px;max-width:58ch}.cs-about-art{aspect-ratio:4/3;border-radius:calc(var(--cs-radius)*1.2);overflow:hidden;background:var(--cs-surface);border:1px solid var(--cs-line)}.cs-about-art img{width:100%;height:100%;object-fit:cover}.cs-about-art.cs-art-placeholder span:nth-child(1){left:10%;top:14%;width:80%;height:70%;border-radius:50% 40% 55% 45%}.cs-about-art.cs-art-placeholder span:nth-child(2){display:none}.cs-reverse .cs-about-grid>div{order:2}.cs-reverse .cs-about-art{order:1}
.cs-gallery-grid{display:grid;grid-template-columns:repeat(var(--cs-cols,2),minmax(0,1fr));gap:var(--cs-gap,14px)}.cs-gallery-item{border-radius:var(--cs-radius);overflow:hidden;border:1px solid var(--cs-line);background:var(--cs-surface);margin:0}.cs-gallery-item img{width:100%;aspect-ratio:4/3;object-fit:cover;transition:transform .4s}.cs-gallery-item:hover img{transform:scale(1.025)}.cs-gallery-1:nth-child(3n+1){grid-column:span 2}.cs-gallery-1:nth-child(3n+1) img{aspect-ratio:16/8.5}.cs-gallery-item figcaption{padding:10px 13px;color:var(--cs-muted);font-size:11px}.cs-work-card{display:flex;flex-direction:column;gap:11px}.cs-work-art{aspect-ratio:4/3;border-radius:var(--cs-radius);border:1px solid var(--cs-line);background:linear-gradient(135deg,color-mix(in srgb,var(--cs-accent) 26%,var(--cs-surface)),var(--cs-surface) 60%,color-mix(in srgb,var(--cs-accent) 9%,var(--cs-bg)))}.cs-work-card:nth-child(3n+1){grid-column:span 2}.cs-work-card:nth-child(3n+1) .cs-work-art{aspect-ratio:16/8.5}.cs-work-meta{display:grid;gap:2px}.cs-work-meta strong{font-size:13px}.cs-work-meta span{font-size:11px;color:var(--cs-muted)}.cs-empty-note{grid-column:1/-1;padding:40px;border:1px dashed var(--cs-line);border-radius:var(--cs-radius);color:var(--cs-muted);text-align:center;font-size:13px}
.cs-quote-grid{display:grid;grid-template-columns:repeat(var(--cs-cols,3),minmax(0,1fr));gap:var(--cs-gap,14px)}.cs-quote{border:1px solid var(--cs-line);border-radius:var(--cs-radius);padding:24px;background:color-mix(in srgb,var(--cs-surface) 68%,transparent);display:flex;flex-direction:column;justify-content:space-between;gap:24px}.cs-quote blockquote{font-size:clamp(16px,1.7vw,20px);line-height:1.45;letter-spacing:-.02em}.cs-quote figcaption{display:grid;gap:1px}.cs-quote figcaption strong{font-size:12.5px}.cs-quote figcaption span{font-size:11px;color:var(--cs-muted)}
.cs-cta-box{border-radius:calc(var(--cs-radius)*1.5);background:var(--cs-accent);color:#fff;padding:clamp(30px,6vw,68px);display:grid;gap:16px;justify-items:start}.cs-cta-box h2{max-width:700px}.cs-cta-box p{color:rgba(255,255,255,.78);max-width:55ch}.cs-cta-box .cs-btn{background:#fff;color:#151519;margin-top:4px}
.cs-contact-grid{display:grid;grid-template-columns:minmax(0,.8fr) minmax(300px,1fr);gap:clamp(30px,6vw,76px);align-items:start}.cs-contact h2{margin-bottom:14px}.cs-contact p{color:var(--cs-muted);max-width:44ch}.cs-mail{display:inline-block;margin-top:18px;color:var(--cs-accent);font-weight:600;font-size:13px}.cs-form{display:grid;gap:12px;padding:22px;border:1px solid var(--cs-line);border-radius:var(--cs-radius);background:var(--cs-surface)}.cs-form label{display:grid;gap:5px;font:600 10px/1 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--cs-muted)}.cs-form input,.cs-form textarea{width:100%;height:38px;border:1px solid var(--cs-line);border-radius:calc(var(--cs-radius)*.45);background:color-mix(in srgb,var(--cs-bg) 70%,var(--cs-surface));color:var(--cs-text);padding:0 11px;font:400 13px/1.4 var(--cs-font);outline:none}.cs-form textarea{height:auto;padding:10px 11px;resize:vertical}.cs-form input:focus,.cs-form textarea:focus{border-color:var(--cs-accent)}.cs-form .cs-btn{margin-top:4px}.cs-hp{display:none!important}.cs-form-ok{color:#34d399;font-size:12px;margin-top:2px}
.cs-footer{padding:28px 0!important;border-top:1px solid var(--cs-line)}.cs-footer-in{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;color:var(--cs-muted);font-size:12px}.cs-footer-links{display:flex;gap:16px}.cs-footer-links a:hover{color:var(--cs-text)}
.cs-custom-frame{width:100%;height:380px;border:1px solid var(--cs-line);border-radius:var(--cs-radius);background:var(--cs-surface)}
.cs-freeform{position:relative;height:var(--cs-freeform-height,460px);border:1px solid var(--cs-line);border-radius:calc(var(--cs-radius)*1.2);overflow:hidden;background:color-mix(in srgb,var(--cs-surface) 34%,transparent)}
.cs-freeform-item{position:absolute;display:flex;flex-direction:column;justify-content:flex-end;padding:clamp(10px,2vw,20px);background:var(--cs-item-bg);color:var(--cs-item-fg);border:1px solid var(--cs-line);border-radius:var(--cs-radius);overflow:hidden;min-width:0}
.cs-freeform-item>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.48}.cs-freeform-body{position:relative;z-index:1;display:grid;gap:3px}.cs-freeform-body strong{font-size:clamp(13px,1.5vw,20px);line-height:1.15;letter-spacing:-.02em}.cs-freeform-body p{font-size:clamp(10px,1.1vw,13px);line-height:1.35;color:color-mix(in srgb,var(--cs-item-fg) 76%,transparent)}.cs-freeform-kicker{font:700 9px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--cs-accent)}
.cs-freeform-item.is-dragging{outline:2px solid var(--cs-accent);cursor:grabbing}.cs-freeform-guide{position:absolute;z-index:30;pointer-events:none;background:var(--cs-accent);opacity:.7}.cs-freeform-guide.is-v{top:0;bottom:0;width:1px}.cs-freeform-guide.is-h{left:0;right:0;height:1px}
.cs-cms-grid{display:grid;grid-template-columns:repeat(var(--cs-cols,3),minmax(0,1fr));gap:var(--cs-gap,16px)}.cs-cms-card{border:1px solid var(--cs-line);border-radius:var(--cs-radius);overflow:hidden;background:color-mix(in srgb,var(--cs-surface) 70%,transparent);display:flex;flex-direction:column}.cs-cms-card>img{width:100%;aspect-ratio:16/10;object-fit:cover}.cs-cms-body{padding:20px;display:grid;gap:8px;flex:1}.cs-cms-body h3{font-size:19px;line-height:1.2;letter-spacing:-.025em}.cs-cms-body p{color:var(--cs-muted);font-size:13px}.cs-cms-link{margin-top:auto;font-size:12px;color:var(--cs-accent);font-weight:600}.cs-cms-empty{padding:42px;border:1px dashed var(--cs-line);border-radius:var(--cs-radius);color:var(--cs-muted);font-size:13px;text-align:center}.cs-cms-item{max-width:820px;margin:0 auto;padding:clamp(48px,8vw,100px) clamp(20px,5vw,48px)}.cs-cms-item h1{font-size:clamp(40px,7vw,76px);line-height:1;letter-spacing:-.055em;margin:8px 0 20px}.cs-cms-cover{width:100%;max-height:480px;object-fit:cover;border-radius:calc(var(--cs-radius)*1.2);margin:20px 0;border:1px solid var(--cs-line)}.cs-cms-copy p{color:var(--cs-muted);line-height:1.7;margin:14px 0;font-size:16px}.cs-cms-copy h2{font-size:28px;margin:26px 0 8px}.cs-cms-item .cs-btn{margin-top:30px}
.cs-anim{animation:cs-rise .7s cubic-bezier(.22,.8,.2,1) both}@keyframes cs-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@media (max-width:${bp.tablet}px){.cs-hero-grid,.cs-about-grid,.cs-contact-grid{grid-template-columns:1fr}.cs-hero-art,.cs-about-art{max-width:560px;width:100%}.cs-feature-grid{grid-template-columns:repeat(var(--cs-cols-tablet,2),minmax(0,1fr))}.cs-gallery-grid,.cs-cms-grid,.cs-quote-grid{grid-template-columns:repeat(var(--cs-cols-tablet,2),minmax(0,1fr))}.cs-nav-links{display:none}.cs-mobile-nav{display:block}.cs-reverse .cs-about-grid>div,.cs-reverse .cs-about-art{order:0}}
@media (max-width:${bp.mobile}px){.cs-wrap{padding-left:18px;padding-right:18px}.cs-hero h1{font-size:clamp(38px,13vw,58px)}.cs-feature-grid,.cs-gallery-grid,.cs-cms-grid,.cs-quote-grid{grid-template-columns:repeat(var(--cs-cols-mobile,1),minmax(0,1fr))}.cs-gallery-1:nth-child(3n+1),.cs-work-card:nth-child(3n+1){grid-column:auto}.cs-cta-box{padding:26px}.cs-actions{flex-direction:column;align-items:stretch}.cs-actions .cs-btn{justify-content:center}.cs-footer-in{align-items:flex-start;flex-direction:column}.cs-nav .cs-btn{display:none}.cs-freeform{height:auto;display:grid;gap:10px;padding:12px}.cs-freeform-item{position:relative!important;left:auto!important;top:auto!important;width:auto!important;height:auto!important;min-height:110px}}
@container (max-width:${bp.tablet}px){.cs-hero-grid,.cs-about-grid,.cs-contact-grid{grid-template-columns:1fr}.cs-hero-art,.cs-about-art{max-width:560px;width:100%}.cs-feature-grid,.cs-gallery-grid,.cs-cms-grid,.cs-quote-grid{grid-template-columns:repeat(var(--cs-cols-tablet,2),minmax(0,1fr))}.cs-nav-links{display:none}.cs-mobile-nav{display:block}.cs-reverse .cs-about-grid>div,.cs-reverse .cs-about-art{order:0}}
@container (max-width:${bp.mobile}px){.cs-wrap{padding-left:18px;padding-right:18px}.cs-hero h1{font-size:clamp(38px,13vw,58px)}.cs-feature-grid,.cs-gallery-grid,.cs-cms-grid,.cs-quote-grid{grid-template-columns:repeat(var(--cs-cols-mobile,1),minmax(0,1fr))}.cs-gallery-1:nth-child(3n+1),.cs-work-card:nth-child(3n+1){grid-column:auto}.cs-cta-box{padding:26px}.cs-actions{flex-direction:column;align-items:stretch}.cs-actions .cs-btn{justify-content:center}.cs-footer-in{align-items:flex-start;flex-direction:column}.cs-nav .cs-btn{display:none}.cs-freeform{height:auto;display:grid;gap:10px;padding:12px}.cs-freeform-item{position:relative!important;left:auto!important;top:auto!important;width:auto!important;height:auto!important;min-height:110px}}
${responsiveSectionCss(content, bp)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;scroll-behavior:auto!important}}
${String(content.customCss || '').replace(/<\/style/gi, '<\\/style')}`;
}

export function renderSiteDocument(content, opts = {}) {
  const theme = content?.theme || {};
  const seo = content?.seo || {};
  const title = seo.title || content?.brand || 'Website';
  const desc = seo.description || '';
  const og = imageSrc(seo.ogImage, opts);
  const body = renderSiteBody(content, opts);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${desc ? `<meta name="description" content="${esc(desc)}">` : ''}
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">
${desc ? `<meta property="og:description" content="${esc(desc)}">` : ''}
${og ? `<meta property="og:image" content="${esc(og)}">` : ''}
<meta name="twitter:card" content="${og ? 'summary_large_image' : 'summary'}">
<style>${siteCss(content)}</style>
</head><body>${body}</body></html>`;
}

export function siteToReact(content) {
  const brand = String(content?.brand || 'Website').replace(/[^A-Za-z0-9]/g, '') || 'Website';
  const css = JSON.stringify(siteCss(content));
  const html = JSON.stringify(renderSiteBody(content, {}));
  return `// Generated by Cascade. Static, self-contained React component.\n// Images are inlined; render this at the page root for an exact copy of the site.\nimport React from "react";\n\nconst css = ${css};\nconst html = ${html};\n\nexport default function ${brand}Site() {\n  return (\n    <div className="cascade-export">\n      <style>{css}</style>\n      <div dangerouslySetInnerHTML={{ __html: html }} />\n    </div>\n  );\n}\n`;
}

export function siteToReactCss(content) {
  return `/* Generated by Cascade. Mirror the look with site tokens and the shared renderer. */\n${siteCss(content)}`;
}
