#!/usr/bin/env node
// Renders backend/content/*.json into the <!--@name-->...<!--/@name--> regions
// of frontend/index.html. Everything outside the markers is left untouched.
// It also generates frontend/robots.txt, sitemap.xml and llms.txt
// (see seo.js).
//
//   npm run export          write changes
//   npm run export:check    exit 1 if the site is out of date (no write)

const fs = require('fs');
const path = require('path');
const { INDEX_HTML } = require('./paths');
const { readAll } = require('./content');
const { validateContent } = require('./validate');
const { esc, commentText, jsonForScript, absoluteUrl } = require('./html');
const { structuredData, generatedFiles, imageSize, pageTitle, locationText } = require('./seo');

// Brand icons for social links; other networks use an emoji (or 🔗).
const SOCIAL_SVG = {
  github:
    'M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z',
  linkedin:
    'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
};
const SOCIAL_EMOJI = { codolio: '💻', leetcode: '🧩', codechef: '👨‍🍳', codeforces: '📊', twitter: '𝕏', x: '𝕏', instagram: '📷', youtube: '▶️' };

/** Email + profile.socials as icon links (hero uses 18px icons, footer 15px). */
function socialLinks(profile, cls, size) {
  const icon = (label) => {
    const key = label.toLowerCase();
    if (SOCIAL_SVG[key]) return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${SOCIAL_SVG[key]}"/></svg>`;
    return esc(SOCIAL_EMOJI[key] || '🔗');
  };
  return [
    ...(profile.email ? [`<a href="mailto:${esc(profile.email)}" class="${cls}" title="Email" aria-label="Email">✉</a>`] : []),
    ...profile.socials.map(
      (s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" class="${cls}" title="${esc(s.label)}" aria-label="${esc(s.label)}">${icon(s.label)}</a>`,
    ),
  ];
}

const heading = ({ text, highlight }) => [text && esc(text), highlight && `<span>${esc(highlight)}</span>`].filter(Boolean).join(' ');
const initials = (name) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0].toUpperCase())
    .join('');
const navLinks = (site, activeFirst) => site.nav.map((n, i) => `<li><a href="#${esc(n.id)}"${activeFirst && i === 0 ? ' class="active"' : ''}>${esc(n.label)}</a></li>`);

// Each renderer returns either a string (inline region) or an array of lines
// (block region, re-indented to the marker's own indentation).
const renderers = {
  // ---------- page chrome (site.json) ----------
  nav: ({ site }) => [
    '<a href="#home" class="nav-logo">',
    `  <span class="bracket">&lt;&gt;</span> ${esc(site.logo)}`,
    '</a>',
    '<ul class="nav-links">',
    ...navLinks(site, true).map((l) => `  ${l}`),
    '</ul>',
  ],

  'hero-socials': ({ profile }) => socialLinks(profile, 'social-btn', 18),

  'hero-scroll': ({ site }) => esc(site.hero.scrollButton),

  ...Object.fromEntries(['about', 'skills', 'projects', 'experience', 'faq', 'contact'].map((id) => [`heading-${id}`, ({ site }) => heading(site.headings[id])])),

  'avatar-initials': ({ profile }) => esc(initials(profile.name)),

  'journey-header': ({ site }) => [
    '<div class="about-card-header">',
    `  <div class="about-card-icon">${esc(site.about.cardIcon)}</div>`,
    `  <h3>${esc(site.about.cardTitle)}</h3>`,
    '</div>',
  ],

  // Category ids are restricted by validate.js to [A-Za-z0-9 _-], so they are
  // safe inside the single-quoted JS string of the onclick attribute.
  'project-filter': ({ site, projects }) => [
    '<button class="filter-btn" id="filterBtn" onclick="toggleFilter()">',
    `  ${esc(site.projects.filterLabel)} <span class="f-blue" id="filterLabel">${esc(site.projects.allLabel)}</span>`,
    '</button>',
    '',
    '<div class="filter-dropdown" id="filterDropdown">',
    `  <div class="filter-dropdown-title">${esc(site.projects.categoriesTitle)}</div>`,
    '',
    `  <div class="filter-opt selected" onclick="setFilter('All',this)">`,
    `    <span class="check">✓</span>${esc(site.projects.allLabel)}`,
    '  </div>',
    ...projects.categories.flatMap((cat) => [
      '',
      `  <div class="filter-opt" onclick="setFilter('${esc(cat.id)}',this)">`,
      `    <span class="check"></span>${esc(cat.label)}`,
      '  </div>',
    ]),
    '</div>',
  ],

  'contact-info': ({ site, profile }) => [
    `<h3>${esc(site.contact.title)}</h3>`,
    `<p>${esc(site.contact.intro)}</p>`,
    ...(profile.email
      ? [`<a href="mailto:${esc(profile.email)}" class="contact-info-item">`, '  <div class="contact-info-icon">✉️</div>', `  ${esc(profile.email)}`, '</a>']
      : []),
    ...(profile.phone
      ? [`<a href="tel:${esc(profile.phone.replace(/[^\d+]/g, ''))}" class="contact-info-item">`, '  <div class="contact-info-icon">📞</div>', `  ${esc(profile.phone)}`, '</a>']
      : []),
    ...(locationText(profile.location)
      ? ['<div class="contact-info-item" style="cursor:default">', '  <div class="contact-info-icon">📍</div>', `  ${esc(locationText(profile.location))}`, '</div>']
      : []),
  ],

  'contact-form': ({ site: { contact: c } }) => [
    '<form id="cForm" method="post">',
    '  <!-- Honeypot: hidden from people, bots tend to fill it in -->',
    '  <div class="hp-field" aria-hidden="true">',
    '    <label for="cf-website">Website</label>',
    '    <input type="text" id="cf-website" name="website" tabindex="-1" autocomplete="off">',
    '  </div>',
    '',
    '  <div class="cform-group">',
    '    <div class="cform-input-wrap">',
    '      <span class="cform-icon">👤</span>',
    `      <input type="text" name="name" placeholder="${esc(c.namePlaceholder)}" aria-label="${esc(c.namePlaceholder)}" autocomplete="name" required>`,
    '    </div>',
    '  </div>',
    '',
    '  <div class="cform-group">',
    '    <div class="cform-input-wrap">',
    '      <span class="cform-icon">✉️</span>',
    `      <input type="email" name="email" placeholder="${esc(c.emailPlaceholder)}" aria-label="${esc(c.emailPlaceholder)}" autocomplete="email" required>`,
    '    </div>',
    '  </div>',
    '',
    '  <div class="cform-group">',
    '    <div class="cform-input-wrap textarea-wrap">',
    '      <span class="cform-icon">💬</span>',
    `      <textarea name="message" placeholder="${esc(c.messagePlaceholder)}" aria-label="${esc(c.messagePlaceholder)}" required></textarea>`,
    '    </div>',
    '  </div>',
    '',
    '  <button type="submit" class="cform-submit">',
    `    ${esc(c.submitButton)}`,
    '  </button>',
    '</form>',
    `<div id="form-ok">${esc(c.successMessage)}</div>`,
  ],

  // The © year is filled in at export time, so it updates itself each year.
  'footer-main': ({ site, profile }) => [
    '<div class="footer-grid">',
    '  <div class="footer-brand">',
    '    <a href="#home" class="nav-logo">',
    `      <span class="bracket">&lt;&gt;</span> ${esc(profile.name)}`,
    '    </a>',
    `    <p>${esc(site.footer.tagline)}</p>`,
    '    <div class="footer-brand-socials">',
    ...socialLinks(profile, 'footer-social', 15).map((l) => `      ${l}`),
    '    </div>',
    '  </div>',
    '  <div class="footer-col">',
    `    <h4>${esc(site.footer.linksTitle)}</h4>`,
    '    <ul>',
    ...navLinks(site, false).map((l) => `      ${l}`),
    '    </ul>',
    '  </div>',
    '  <div class="footer-col">',
    `    <h4>${esc(site.footer.connectTitle)}</h4>`,
    `    <p>${esc(site.footer.connectText)}</p>`,
    `    <a href="#contact" class="footer-get-btn">${esc(site.footer.connectButton)}</a>`,
    '  </div>',
    '</div>',
    `<p class="footer-copy">Designed &amp; Built with <span>♥</span> by ${esc(profile.name)}. &nbsp;© ${new Date().getFullYear()}. All rights reserved.</p>`,
  ],

  // ---------- head + content ----------
  title: ({ profile }) => `<title>${esc(pageTitle(profile))}</title>`,

  // Classic SEO: snippet text, canonical URL, crawl directives, browser UI colour.
  seo: ({ profile }) => [
    `<meta name="description" content="${esc(profile.seoDescription)}" />`,
    `<meta name="author" content="${esc(profile.name)}" />`,
    '<meta name="robots" content="index, follow" />',
    `<link rel="canonical" href="${esc(profile.siteUrl)}" />`,
    ...(profile.themeColor ? [`<meta name="theme-color" content="${esc(profile.themeColor)}" />`] : []),
  ],

  // Link previews (LinkedIn, WhatsApp, Slack, X...).
  og: ({ profile }) => {
    const [first, ...rest] = profile.name.trim().split(/\s+/);
    const image = absoluteUrl(profile.siteUrl, profile.ogImage);
    const size = imageSize(profile.ogImage);
    return [
      '<meta property="og:type" content="profile" />',
      `<meta property="og:site_name" content="${esc(profile.name)}" />`,
      `<meta property="og:title" content="${esc(pageTitle(profile))}" />`,
      `<meta property="og:description" content="${esc(profile.seoDescription)}" />`,
      `<meta property="og:url" content="${esc(profile.siteUrl)}" />`,
      `<meta property="og:image" content="${esc(image)}" />`,
      ...(size ? [`<meta property="og:image:width" content="${size.width}" />`, `<meta property="og:image:height" content="${size.height}" />`] : []),
      ...(profile.ogImageAlt ? [`<meta property="og:image:alt" content="${esc(profile.ogImageAlt)}" />`] : []),
      '<meta property="og:locale" content="en_IN" />',
      `<meta property="profile:first_name" content="${esc(first)}" />`,
      ...(rest.length ? [`<meta property="profile:last_name" content="${esc(rest.join(' '))}" />`] : []),
      '<meta name="twitter:card" content="summary_large_image" />',
      `<meta name="twitter:title" content="${esc(pageTitle(profile))}" />`,
      `<meta name="twitter:description" content="${esc(profile.seoDescription)}" />`,
      `<meta name="twitter:image" content="${esc(image)}" />`,
      ...(profile.ogImageAlt ? [`<meta name="twitter:image:alt" content="${esc(profile.ogImageAlt)}" />`] : []),
    ];
  },

  // Schema.org JSON-LD (Person, WebSite, ProfilePage, projects, FAQPage).
  'structured-data': (content) => ['<script type="application/ld+json">', ...jsonForScript(structuredData(content)).split('\n'), '</script>'],

  // GA4: external script, so there is no inline JS. It skips itself on localhost.
  analytics: ({ profile }) => (profile.gaId ? [`<script src="js/analytics.js" data-ga-id="${esc(profile.gaId)}" defer></script>`] : []),

  // Above the fold: load eagerly with high priority (it's the LCP image).
  'hero-photo': ({ profile }) => [
    `<img src="${esc(profile.photo)}"`,
    `     alt="${esc(profile.photoAlt || profile.name)}"`,
    '     width="160" height="160"',
    '     fetchpriority="high" decoding="async"',
    '     class="hero-avatar rv">',
  ],

  'hero-name': ({ profile }) => {
    const [first, ...rest] = profile.name.trim().split(/\s+/);
    return rest.length ? `${esc(first)} <span>${esc(rest.join(' '))}</span>` : esc(first);
  },

  tagline: ({ profile }) => esc(profile.tagline),

  'resume-link': ({ site, profile }) => [
    `<a href="resume/${esc(encodeURIComponent(profile.resumeFile))}"`,
    '   download',
    '   class="hero-resume-btn">',
    `   ${esc(site.hero.resumeButton)}`,
    '</a>',
  ],

  'education-summary': ({ profile: { education: e } }) => [
    `${esc(e.degreeShort)}<br/>`,
    `${esc(e.institutionShort)} · ${esc(e.startYear)}–${esc(e.endYear)}`,
  ],

  education: ({ profile: { education: e } }) => [
    '<div class="about-card">',
    '  <div class="about-card-header">',
    '    <div class="about-card-icon">🎓</div>',
    '    <div>',
    `      <h3>${esc(e.degree)}</h3>`,
    `      <div class="inst">${esc(e.institution)}</div>`,
    '    </div>',
    '  </div>',
    `  <div class="meta">${esc(e.startYear)} – ${esc(e.endYear)} &nbsp;·&nbsp; ${esc(e.location)}</div>`,
    ...(e.cgpa
      ? [`  <div class="meta" style="margin-top:0.25rem;color:var(--blue)">CGPA: ${esc(e.cgpa)}${e.cgpaScale ? ` / ${esc(e.cgpaScale)}` : ''}</div>`]
      : []),
    '</div>',
  ],

  about: ({ profile }) =>
    profile.about.map((para, i) => (i === 0 ? `<p>${esc(para)}</p>` : `<p style="margin-top:0.75rem">${esc(para)}</p>`)),

  skills: ({ skills }) =>
    skills.flatMap((group) => [
      '<div class="skill-card rv">',
      '  <div class="skill-card-top">',
      `    <div class="skill-cat-icon">${esc(group.icon)}</div>`,
      `    <h3>${esc(group.name)}</h3>`,
      '  </div>',
      '  <div class="skill-tags">',
      ...group.items.map((item) => `    <span class="stag">${esc(item)}</span>`),
      '  </div>',
      '</div>',
    ]),

  projects: ({ projects }) =>
    projects.items.flatMap((p, i) => {
      const linkLines = p.links.flatMap((link, j) => [
        ...(j ? ['<br><br>'] : []),
        `<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" class="proj-link">${esc(link.label)}</a>`,
      ]);
      return [
        ...(i ? [''] : []),
        `<!-- ${commentText(p.title)} -->`,
        `<div class="proj-card rv" data-cat="${esc(p.category)}">`,
        `  <div class="proj-thumb"${p.thumbBackground ? ` style="background:${esc(p.thumbBackground)}"` : ''}>`,
        `    <div class="proj-thumb-text">${esc(p.thumbText)}</div>`,
        `    <span class="proj-thumb-label">${esc(p.thumbLabel)}</span>`,
        `    <div class="proj-thumb-icon">${esc(p.icon)}</div>`,
        '  </div>',
        '  <div class="proj-body">',
        `    <div class="proj-meta">📅 ${esc(p.date)}</div>`,
        `    <h3>${esc(p.title)}</h3>`,
        `    <p class="proj-desc">${esc(p.description)}</p>`,
        '    <div class="proj-techs">',
        ...p.techs.map((t) => `      <span class="proj-tech">${esc(t)}</span>`),
        '    </div>',
        ...linkLines.map((l) => `    ${l}`),
        ...(p.note ? [`    <span class="proj-link">${esc(p.note)}</span>`] : []),
        '  </div>',
        '</div>',
      ];
    }),

  experience: ({ experience }) =>
    experience.flatMap((x, i) => [
      ...(i ? [''] : []),
      '<div class="exp-item rv">',
      '  <div class="exp-dot"></div>',
      `  <div class="exp-period">${esc(x.period)}</div>`,
      '  <div class="exp-card">',
      '    <div class="exp-card-top">',
      `      <div class="exp-icon">${esc(x.icon)}</div>`,
      '      <div style="flex:1">',
      `        <h3 class="exp-role">${esc(x.role)}</h3>`,
      `        <div class="exp-company">${esc(x.company)}</div>`,
      '      </div>',
      ...(x.badge ? [`      <div class="exp-remote">${esc(x.badge)}</div>`] : []),
      '    </div>',
      '    <ul class="exp-points">',
      ...x.points.map((pt) => `      <li>${esc(pt)}</li>`),
      '    </ul>',
      '    <div class="exp-tags">',
      ...x.tags.map((t) => `      <span class="exp-tag">${esc(t)}</span>`),
      '    </div>',
      '  </div>',
      '</div>',
    ]),

  // Visible FAQ: same questions and answers as the FAQPage JSON-LD.
  faq: ({ profile }) =>
    profile.faq.flatMap((f) => [
      '<details class="faq-item rv">',
      `  <summary><h3>${esc(f.question)}</h3></summary>`,
      `  <p>${esc(f.answer)}</p>`,
      '</details>',
    ]),

  'analytics-notice': ({ profile }) =>
    profile.gaId ? ['<p class="footer-analytics">This site uses Google Analytics to understand how visitors use it.</p>'] : [],
};

/** Replaces every marker region in `html` (LF line endings). */
function renderRegions(html, content) {
  let out = html;
  for (const [name, render] of Object.entries(renderers)) {
    const open = `<!--@${name}-->`;
    const close = `<!--/@${name}-->`;
    const start = out.indexOf(open);
    const end = out.indexOf(close);
    if (start === -1 || end === -1) throw new Error(`Marker ${open} … ${close} not found in index.html`);
    if (out.indexOf(open, start + 1) !== -1 || out.indexOf(close, end + 1) !== -1) throw new Error(`Marker ${open} appears more than once`);
    if (end < start) throw new Error(`Marker ${close} comes before ${open}`);

    const rendered = render(content);
    let inner;
    if (Array.isArray(rendered)) {
      const lineStart = out.lastIndexOf('\n', start) + 1;
      const indent = out.slice(lineStart, start);
      if (/\S/.test(indent)) throw new Error(`Block marker ${open} must be on its own line`);
      const body = rendered.map((line) => (line ? indent + line : '')).join('\n');
      inner = rendered.length ? `\n${body}\n${indent}` : `\n${indent}`;
    } else {
      inner = rendered;
    }
    out = out.slice(0, start + open.length) + inner + out.slice(end);
  }
  const unknown = [...out.matchAll(/<!--@([\w-]+)-->/g)].map((m) => m[1]).filter((n) => !renderers[n]);
  if (unknown.length) throw new Error(`Unknown marker(s) in index.html: ${unknown.join(', ')}`);
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Renders saved content into frontend/index.html plus the generated files.
 * Returns { changed, written, files } where `files` lists the paths (relative
 * to frontend/) that differ. With { check: true } nothing is written.
 *
 * sitemap <lastmod> is the date of the last export that actually changed the
 * site, so re-running on unchanged content stays a no-op (and Google keeps
 * trusting the date).
 */
function exportSite({ check = false, content = readAll(), dir = path.dirname(INDEX_HTML) } = {}) {
  const errors = validateContent(content);
  if (errors.length) throw new Error(`Content is invalid:\n- ${errors.join('\n- ')}`);

  const read = (name) => {
    const file = path.join(dir, name);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };
  const withEol = (text, before) => (before && before.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text);

  const outputs = [];
  const indexBefore = read('index.html');
  outputs.push({ name: 'index.html', before: indexBefore, after: withEol(renderRegions(indexBefore.replace(/\r\n/g, '\n'), content), indexBefore) });

  const sitemapBefore = read('sitemap.xml');
  const previousLastmod = sitemapBefore && (sitemapBefore.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1];
  for (const [name, render] of Object.entries(generatedFiles)) {
    if (name === 'sitemap.xml') continue;
    const before = read(name);
    outputs.push({ name, before, after: withEol(render(content, {}), before) });
  }
  const siteChanged = outputs.some((o) => o.before !== o.after);
  const lastmod = siteChanged || !previousLastmod ? today() : previousLastmod;
  outputs.push({ name: 'sitemap.xml', before: sitemapBefore, after: withEol(generatedFiles['sitemap.xml'](content, { lastmod }), sitemapBefore) });

  const files = outputs.filter((o) => o.before !== o.after).map((o) => o.name);
  if (!check) {
    for (const o of outputs) if (o.before !== o.after) fs.writeFileSync(path.join(dir, o.name), o.after, 'utf8');
  }
  return { changed: files.length > 0, written: files.length > 0 && !check, files };
}

module.exports = { exportSite, renderRegions, renderers };

if (require.main === module) {
  const check = process.argv.includes('--check');
  try {
    const { changed, files } = exportSite({ check });
    const list = files.map((f) => `frontend/${f}`).join(', ');
    if (check) {
      console.log(changed ? `Out of date: ${list} — run \`npm run export\`.` : 'Site is up to date with the content.');
      process.exitCode = changed ? 1 : 0;
    } else {
      console.log(changed ? `Exported content to ${list}.` : 'Site already matches the content — nothing to change.');
    }
  } catch (err) {
    console.error(`Export failed: ${err.message}`);
    process.exitCode = 1;
  }
}
