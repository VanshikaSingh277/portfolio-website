'use strict';

// ---------- state ----------
const state = {
  content: null, // working copy being edited
  savedJson: '', // JSON of the last saved/loaded content
  section: 'profile',
  busy: false,
};

const $ = (sel) => document.querySelector(sel);
const isDirty = () => state.content !== null && JSON.stringify(state.content) !== state.savedJson;

// ---------- API ----------
async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = { method, headers: { 'X-Requested-With': 'portfolio-admin', ...headers }, credentials: 'same-origin' };
  if (body instanceof Blob) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api/admin${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    showLogin();
    throw new Error('Your session expired. Please log in again.');
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.details = data.details;
    throw err;
  }
  return data;
}

// ---------- small DOM helpers (always textContent, never innerHTML) ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function showMessage(text, type = 'success', details) {
  const box = $('#messages');
  box.replaceChildren(
    el('div', { class: `message ${type}`, role: type === 'error' ? 'alert' : 'status' }, text, details && details.length ? el('ul', {}, details.map((d) => el('li', {}, d))) : null),
  );
  if (type === 'success') setTimeout(() => box.firstChild && box.firstChild.textContent === text && box.replaceChildren(), 6000);
}

function updateStatus(text, kind) {
  const status = $('#save-status');
  if (!text) {
    const dirty = isDirty();
    text = dirty ? 'Unsaved changes' : 'All changes saved';
    kind = dirty ? 'dirty' : '';
  }
  status.textContent = text;
  status.className = `status ${kind || ''}`;
  $('#save-btn').disabled = state.busy || !isDirty();
  $('#export-btn').disabled = state.busy;
  updateCounts();
}

function updateCounts() {
  const c = state.content;
  const counts = c
    ? {
        projects: c.projects.items.length,
        experience: c.experience.length,
        skills: c.skills.reduce((n, g) => n + g.items.length, 0),
        site: c.profile.faq.length,
      }
    : {};
  document.querySelectorAll('#nav [data-count]').forEach((node) => {
    const value = counts[node.getAttribute('data-count')];
    node.textContent = value == null ? '' : String(value);
  });
}

const changed = () => updateStatus();

// ---------- field builders ----------
// Parsers turn the input's text into the stored value; formatters do the reverse.
const FORMATS = {
  text: { format: (v) => v ?? '', parse: (s) => s },
  textarea: { format: (v) => v ?? '', parse: (s) => s },
  tags: { format: (v) => (v || []).join(', '), parse: (s) => s.split(',').map((x) => x.trim()).filter(Boolean) },
  lines: { format: (v) => (v || []).join('\n'), parse: (s) => s.split('\n').map((x) => x.trim()).filter(Boolean) },
  paragraphs: { format: (v) => (v || []).join('\n\n'), parse: (s) => s.split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean) },
  links: {
    format: (v) => (v || []).map((l) => `${l.label} | ${l.url}`).join('\n'),
    parse: (s) =>
      s
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const i = line.lastIndexOf('|');
          return i === -1 ? { label: line, url: '' } : { label: line.slice(0, i).trim(), url: line.slice(i + 1).trim() };
        }),
  },
};

let fieldSeq = 0;
/** One labelled input bound to obj[key]. */
function field(obj, key, { label, type = 'text', help, options, onChange, count } = {}) {
  const id = `f${++fieldSeq}`;
  const fmt = FORMATS[type] || FORMATS.text;
  let input;
  if (type === 'select') {
    input = el('select', { id }, (typeof options === 'function' ? options() : options).map((o) => el('option', { value: o.value }, o.label)));
    input.value = obj[key] ?? '';
  } else if (type === 'text') {
    input = el('input', { id, type: 'text', value: fmt.format(obj[key]) });
  } else {
    input = el('textarea', { id, rows: type === 'paragraphs' ? 8 : 4 });
    input.value = fmt.format(obj[key]);
  }
  // Optional live length counter, e.g. count: [150, 160] for meta descriptions.
  const counter = count ? el('span', { class: 'counter' }) : null;
  const updateCounter = () => {
    if (!counter) return;
    const n = input.value.trim().length;
    counter.textContent = ` · ${n} characters (aim for ${count[0]}–${count[1]})`;
    counter.classList.toggle('off', n < count[0] || n > count[1]);
  };
  updateCounter();
  input.addEventListener(type === 'select' ? 'change' : 'input', () => {
    obj[key] = type === 'select' ? input.value : fmt.parse(input.value);
    updateCounter();
    if (onChange) onChange();
    changed();
  });
  return el('div', { class: 'field' }, el('label', { for: id }, label), input, help || counter ? el('div', { class: 'help' }, help || '', counter) : null);
}

/** A reorderable list of collapsible items. */
function listEditor({ items, title, blank, render, addLabel, rerender }) {
  const wrap = el('div');
  items.forEach((item, index) => {
    const titleNode = el('span', { class: 'item-title' }, title(item) || '(untitled)');
    const refreshTitle = () => (titleNode.textContent = title(item) || '(untitled)');
    const move = (delta) => (event) => {
      event.preventDefault();
      const target = index + delta;
      if (target < 0 || target >= items.length) return;
      [items[index], items[target]] = [items[target], items[index]];
      changed();
      rerender();
    };
    const remove = (event) => {
      event.preventDefault();
      if (!confirm(`Remove "${title(item) || 'this item'}"?`)) return;
      items.splice(index, 1);
      changed();
      rerender();
    };
    wrap.append(
      el(
        'details',
        { class: 'item' },
        el(
          'summary',
          {},
          titleNode,
          el(
            'span',
            { class: 'item-actions' },
            el('button', { type: 'button', class: 'btn small', title: 'Move up', 'aria-label': 'Move up', disabled: index === 0, onclick: move(-1) }, '↑'),
            el('button', { type: 'button', class: 'btn small', title: 'Move down', 'aria-label': 'Move down', disabled: index === items.length - 1, onclick: move(1) }, '↓'),
            el('button', { type: 'button', class: 'btn small danger', onclick: remove }, 'Remove'),
          ),
        ),
        el('div', { class: 'item-body' }, render(item, refreshTitle)),
      ),
    );
  });
  wrap.append(
    el(
      'button',
      {
        type: 'button',
        class: 'btn',
        onclick: () => {
          items.push(blank());
          changed();
          rerender();
          const all = document.querySelectorAll('#section-body details.item');
          const last = all[all.length - 1];
          if (last) {
            last.open = true;
            last.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        },
      },
      addLabel,
    ),
  );
  return wrap;
}

// ---------- sections ----------
const sections = {
  profile: {
    title: 'Profile',
    subtitle: 'Your name, intro, contact details, education and photo.',
    render() {
      const p = state.content.profile;
      const e = p.education;
      return [
        el('h3', {}, 'About you'),
        el(
          'div',
          { class: 'grid-2' },
          field(p, 'name', { label: 'Full name', help: 'The first word is shown plain, the rest highlighted.' }),
          field(p, 'jobTitle', { label: 'Job title', help: 'Short role used by search engines and AI answers, e.g. "Backend Developer".' }),
        ),
        field(p, 'tagline', { label: 'Line under your name' }),
        field(p, 'about', { label: 'About me', type: 'paragraphs', help: 'Separate paragraphs with a blank line. The first paragraph is also your summary for AI assistants (llms.txt).' }),
        el('h3', {}, 'Contact'),
        el(
          'div',
          { class: 'grid-2' },
          field(p, 'email', { label: 'Email' }),
          field(p, 'phone', { label: 'Phone', help: 'Optional. Leave empty to keep it off the site.' }),
          field(p.location, 'city', { label: 'City' }),
          field(p.location, 'region', { label: 'State / region' }),
          field(p.location, 'country', { label: 'Country' }),
          field(p.location, 'countryCode', { label: 'Country code', help: 'Two letters, e.g. IN. Used in structured data.' }),
        ),
        field(p, 'socials', { label: 'Profiles', type: 'links', help: 'One per line: Label | https://url. Tells Google and AI tools these accounts are you.' }),
        el('h3', {}, 'Education'),
        el(
          'div',
          { class: 'grid-2' },
          field(e, 'degree', { label: 'Degree' }),
          field(e, 'degreeShort', { label: 'Degree (short)' }),
          field(e, 'institution', { label: 'Institution' }),
          field(e, 'institutionShort', { label: 'Institution (short)' }),
          field(e, 'startYear', { label: 'Start year' }),
          field(e, 'endYear', { label: 'End year' }),
          field(e, 'location', { label: 'Location' }),
          field(e, 'cgpa', { label: 'CGPA', help: 'Leave empty to hide.' }),
          field(e, 'cgpaScale', { label: 'CGPA out of' }),
        ),
        el('h3', {}, 'Photo'),
        el(
          'div',
          { class: 'grid-2' },
          field(p, 'photo', { label: 'Profile photo', help: 'Path inside frontend/, e.g. assets/images/VSC.jpeg' }),
          field(p, 'photoAlt', { label: 'Photo description (alt text)', help: 'Read by screen readers and search engines.' }),
        ),
      ];
    },
  },

  site: {
    title: 'Site & SEO',
    subtitle: 'Search results, link previews, analytics and the FAQ that Google and AI assistants read.',
    render() {
      const p = state.content.profile;
      return [
        el('h3', {}, 'Search results'),
        field(p, 'seoTitle', { label: 'Page title', help: 'Your name and role. Shown in Google and browser tabs', count: [30, 60] }),
        field(p, 'seoDescription', { label: 'Meta description', type: 'textarea', help: 'The snippet under your title in Google and in link previews', count: [150, 160] }),
        el(
          'div',
          { class: 'grid-2' },
          field(p, 'siteUrl', { label: 'Site URL', help: 'Must end with /, e.g. https://vanshikasingh.vercel.app/' }),
          field(p, 'themeColor', { label: 'Theme colour', help: 'Browser bar colour on phones, e.g. #0a0d14' }),
        ),
        el('h3', {}, 'Link previews'),
        el(
          'div',
          { class: 'grid-2' },
          field(p, 'ogImage', { label: 'Preview image', help: 'Path inside frontend/. 1200×630 works best.' }),
          field(p, 'ogImageAlt', { label: 'Preview image description' }),
        ),
        el('h3', {}, 'Google Analytics'),
        field(p, 'gaId', { label: 'GA4 measurement ID', help: 'Looks like G-ABC123XYZ. Leave empty to turn analytics off. Never loads on localhost.' }),
        el('h3', {}, 'FAQ'),
        el('p', { class: 'hint' }, 'Shown on the page above Contact and sent to Google as FAQ structured data. Answer in full sentences that make sense on their own.'),
        listEditor({
          items: p.faq,
          title: (f) => f.question,
          blank: () => ({ question: '', answer: '' }),
          addLabel: '+ Add question',
          rerender: renderSection,
          render: (f, refresh) => [field(f, 'question', { label: 'Question', onChange: refresh }), field(f, 'answer', { label: 'Answer', type: 'textarea' })],
        }),
      ];
    },
  },

  pagetext: {
    title: 'Page text',
    subtitle: 'Menu, section headings, buttons, contact form and footer wording.',
    render() {
      const s = state.content.site;
      const headingNames = { about: 'About', skills: 'Skills', projects: 'Projects', experience: 'Experience', faq: 'FAQ', contact: 'Contact' };
      return [
        el('h3', {}, 'Menu'),
        field(s, 'logo', { label: 'Logo text', help: 'Shown next to <> in the top bar.' }),
        el('p', { class: 'hint' }, 'Menu items (also used for Quick Links in the footer). The ID must be a section on the page: home, about, skills, projects, experience, faq or contact.'),
        listEditor({
          items: s.nav,
          title: (n) => n.label,
          blank: () => ({ id: '', label: '' }),
          addLabel: '+ Add menu item',
          rerender: renderSection,
          render: (n, refresh) => el('div', { class: 'grid-2' }, field(n, 'label', { label: 'Label', onChange: refresh }), field(n, 'id', { label: 'Section ID' })),
        }),
        el('h3', {}, 'Section headings'),
        el('p', { class: 'hint' }, 'Each heading is plain text followed by a highlighted (blue) part, e.g. "My" + "Skills".'),
        el(
          'div',
          { class: 'grid-2' },
          Object.entries(headingNames).flatMap(([key, name]) => [
            field(s.headings[key], 'text', { label: `${name}: text` }),
            field(s.headings[key], 'highlight', { label: `${name}: highlighted` }),
          ]),
        ),
        el('h3', {}, 'Top of the page'),
        el('div', { class: 'grid-2' }, field(s.hero, 'resumeButton', { label: 'Resume button' }), field(s.hero, 'scrollButton', { label: 'Scroll button' })),
        el('h3', {}, 'About card'),
        el('div', { class: 'grid-2' }, field(s.about, 'cardTitle', { label: 'Card title' }), field(s.about, 'cardIcon', { label: 'Card icon (emoji)' })),
        el('h3', {}, 'Projects filter'),
        el(
          'div',
          { class: 'grid-2' },
          field(s.projects, 'filterLabel', { label: 'Filter button' }),
          field(s.projects, 'categoriesTitle', { label: 'Menu title' }),
          field(s.projects, 'allLabel', { label: '"All" option' }),
        ),
        el('h3', {}, 'Contact'),
        field(s.contact, 'title', { label: 'Title' }),
        field(s.contact, 'intro', { label: 'Intro', type: 'textarea' }),
        el(
          'div',
          { class: 'grid-2' },
          field(s.contact, 'namePlaceholder', { label: 'Name placeholder' }),
          field(s.contact, 'emailPlaceholder', { label: 'Email placeholder' }),
          field(s.contact, 'messagePlaceholder', { label: 'Message placeholder' }),
          field(s.contact, 'submitButton', { label: 'Send button' }),
        ),
        field(s.contact, 'successMessage', { label: 'Message after sending' }),
        el('h3', {}, 'Footer'),
        field(s.footer, 'tagline', { label: 'Tagline', type: 'textarea' }),
        el('div', { class: 'grid-2' }, field(s.footer, 'linksTitle', { label: 'Links title' }), field(s.footer, 'connectTitle', { label: 'Connect title' })),
        field(s.footer, 'connectText', { label: 'Connect text', type: 'textarea' }),
        field(s.footer, 'connectButton', { label: 'Connect button' }),
      ];
    },
  },

  projects: {
    title: 'Projects',
    subtitle: 'Filter categories and the cards in the Projects section.',
    render() {
      const pr = state.content.projects;
      const categoryOptions = () => pr.categories.map((c) => ({ value: c.id, label: c.label || c.id }));
      return [
        el('h3', {}, 'Filter categories'),
        el('p', { class: 'hint' }, 'The filter menu on the site. Each project belongs to one category.'),
        listEditor({
          items: pr.categories,
          title: (c) => c.label || c.id,
          blank: () => ({ id: '', label: '' }),
          addLabel: '+ Add category',
          rerender: renderSection,
          render: (c, refresh) => el('div', { class: 'grid-2' }, field(c, 'id', { label: 'ID', help: 'Letters, numbers, spaces, _ and - only.', onChange: refresh }), field(c, 'label', { label: 'Label', onChange: refresh })),
        }),
        el('h3', {}, 'Projects'),
        listEditor({
          items: pr.items,
          title: (p) => p.title,
          blank: () => ({ id: '', title: '', category: pr.categories[0]?.id || '', date: '', thumbText: '', thumbLabel: '', icon: '', thumbBackground: '', description: '', techs: [], links: [], note: '' }),
          addLabel: '+ Add project',
          rerender: renderSection,
          render: (p, refresh) => [
            el('div', { class: 'grid-2' }, field(p, 'title', { label: 'Title', onChange: refresh }), field(p, 'id', { label: 'ID', help: 'Used by /api/projects/:id — lowercase-with-dashes.' })),
            el('div', { class: 'grid-2' }, field(p, 'category', { label: 'Category', type: 'select', options: categoryOptions }), field(p, 'date', { label: 'Date' })),
            field(p, 'description', { label: 'Description', type: 'textarea' }),
            field(p, 'techs', { label: 'Technologies', type: 'tags', help: 'Comma-separated.' }),
            field(p, 'links', { label: 'Links', type: 'links', help: 'One per line: Label | https://url' }),
            field(p, 'note', { label: 'Note', help: 'Shown instead of / after links, e.g. "Client Project • Confidential".' }),
            el('div', { class: 'grid-2' }, field(p, 'thumbText', { label: 'Thumbnail text' }), field(p, 'thumbLabel', { label: 'Thumbnail label' }), field(p, 'icon', { label: 'Icon (emoji)' }), field(p, 'thumbBackground', { label: 'Thumbnail background', help: 'CSS background, e.g. linear-gradient(135deg,#1a2535,#0f1a28). Empty = default.' })),
          ],
        }),
      ];
    },
  },

  experience: {
    title: 'Experience',
    subtitle: 'Internships and roles on your timeline.',
    render() {
      return [
        listEditor({
          items: state.content.experience,
          title: (x) => [x.role, x.company].filter(Boolean).join(' — '),
          blank: () => ({ period: '', icon: '', role: '', company: '', badge: '', points: [], tags: [] }),
          addLabel: '+ Add experience',
          rerender: renderSection,
          render: (x, refresh) => [
            el('div', { class: 'grid-2' }, field(x, 'role', { label: 'Role', onChange: refresh }), field(x, 'company', { label: 'Company', onChange: refresh }), field(x, 'period', { label: 'Period' }), field(x, 'badge', { label: 'Badge', help: 'e.g. Ongoing, On-site, Remote' }), field(x, 'icon', { label: 'Icon (emoji)' })),
            field(x, 'points', { label: 'Highlights', type: 'lines', help: 'One per line.' }),
            field(x, 'tags', { label: 'Tags', type: 'tags', help: 'Comma-separated.' }),
          ],
        }),
      ];
    },
  },

  skills: {
    title: 'Tools and skills',
    subtitle: 'Skill groups shown as cards in the Skills section.',
    render() {
      return [
        el('p', { class: 'hint' }, 'Each group becomes a card in the Skills section.'),
        listEditor({
          items: state.content.skills,
          title: (g) => `${g.icon ? `${g.icon} ` : ''}${g.name}`,
          blank: () => ({ name: '', icon: '', items: [] }),
          addLabel: '+ Add group',
          rerender: renderSection,
          render: (g, refresh) => [
            el('div', { class: 'grid-2' }, field(g, 'name', { label: 'Group name', onChange: refresh }), field(g, 'icon', { label: 'Icon (emoji)', onChange: refresh })),
            field(g, 'items', { label: 'Skills', type: 'tags', help: 'Comma-separated.' }),
          ],
        }),
      ];
    },
  },

  resume: {
    title: 'Resume',
    subtitle: 'The PDF behind the Download Resume button.',
    render() {
      const p = state.content.profile;
      const table = el('tbody', {}, el('tr', {}, el('td', { colspan: 3, class: 'muted' }, 'Loading…')));
      const fileInput = el('input', { id: 'resume-file', type: 'file', accept: 'application/pdf,.pdf' });
      const nameInput = el('input', { id: 'resume-name', type: 'text', placeholder: 'MY_RESUME.pdf' });
      fileInput.addEventListener('change', () => {
        const f = fileInput.files[0];
        if (f) nameInput.value = f.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[^A-Za-z0-9]+/, '');
      });

      const load = async () => {
        try {
          const files = await api('/resumes');
          table.replaceChildren(
            ...(files.length ? files : [null]).map((f) =>
              f
                ? el(
                    'tr',
                    {},
                    el('td', {}, f.name, ' ', f.name === p.resumeFile ? el('span', { class: 'badge' }, 'linked on site') : null),
                    el('td', { class: 'muted' }, `${Math.round(f.size / 1024)} KB`),
                    el(
                      'td',
                      {},
                      f.name === p.resumeFile
                        ? null
                        : el('button', { type: 'button', class: 'btn small', onclick: () => { p.resumeFile = f.name; changed(); renderSection(); showMessage(`Download button now points to ${f.name}. Save changes, then export.`); } }, 'Use this'),
                    ),
                  )
                : el('tr', {}, el('td', { colspan: 3, class: 'muted' }, 'No PDFs in frontend/resume yet.')),
            ),
          );
        } catch (err) {
          showMessage(err.message, 'error');
        }
      };

      const upload = async (event) => {
        event.preventDefault();
        const f = fileInput.files[0];
        if (!f) return showMessage('Choose a PDF first.', 'error');
        if (f.size > 10 * 1024 * 1024) return showMessage('PDF must be 10 MB or smaller.', 'error');
        try {
          const result = await api(`/resume?filename=${encodeURIComponent(nameInput.value.trim())}`, { method: 'POST', body: f, headers: { 'Content-Type': 'application/pdf' } });
          p.resumeFile = result.name;
          changed();
          renderSection();
          showMessage(`Uploaded ${result.name} and linked it. Save changes, then export to update the site.`);
        } catch (err) {
          showMessage(err.message, 'error');
        }
      };

      load();
      return [
        el('p', { class: 'hint' }, 'PDFs live in frontend/resume/. The one marked "linked on site" is what the Download Resume button serves.'),
        el('table', { class: 'table' }, el('thead', {}, el('tr', {}, el('th', {}, 'File'), el('th', {}, 'Size'), el('th', {}, ''))), table),
        el('h3', {}, 'Upload a new PDF'),
        el(
          'form',
          { class: 'upload', onsubmit: upload },
          el('div', { class: 'field' }, el('label', { for: 'resume-file' }, 'PDF file'), fileInput),
          el('div', { class: 'field' }, el('label', { for: 'resume-name' }, 'Save as'), nameInput),
          el('button', { type: 'submit', class: 'btn primary' }, 'Upload'),
        ),
        el('p', { class: 'hint' }, 'Uploading a file with an existing name replaces it. Resume files are not included in History snapshots.'),
      ];
    },
  },

  history: {
    title: 'History',
    subtitle: 'Snapshots taken before every save. Restore any of them.',
    render() {
      const body = el('tbody', {}, el('tr', {}, el('td', { colspan: 3, class: 'muted' }, 'Loading…')));
      const restore = (snap) => async () => {
        if (isDirty() && !confirm('You have unsaved changes. Restoring will discard them. Continue?')) return;
        if (!confirm(`Restore content from ${formatDate(snap.createdAt) || snap.id}? Current content is snapshotted first.`)) return;
        try {
          const result = await api(`/history/${encodeURIComponent(snap.id)}/restore`, { method: 'POST' });
          setContent(result.content);
          renderSection();
          showMessage(result.changed ? 'Restored. Export to site to publish it.' : 'That snapshot matches the current content — nothing changed.');
        } catch (err) {
          showMessage(err.message, 'error', err.details);
        }
      };
      api('/history')
        .then((snaps) => {
          body.replaceChildren(
            ...(snaps.length
              ? snaps.map((s) => el('tr', {}, el('td', {}, formatDate(s.createdAt) || s.id), el('td', { class: 'muted' }, s.reason), el('td', {}, el('button', { type: 'button', class: 'btn small', onclick: restore(s) }, 'Restore'))))
              : [el('tr', {}, el('td', { colspan: 3, class: 'muted' }, 'No snapshots yet. One is taken automatically before every save.'))]),
          );
        })
        .catch((err) => showMessage(err.message, 'error'));
      return [
        el('p', { class: 'hint' }, 'A snapshot of all content files is taken before each save and restore (last 50 kept, stored in backend/content/.history, not committed).'),
        el('table', { class: 'table' }, el('thead', {}, el('tr', {}, el('th', {}, 'Saved'), el('th', {}, 'Reason'), el('th', {}, ''))), body),
      ];
    },
  },
};

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function renderSection() {
  const section = sections[state.section];
  // Portfolio-style heading: last word in the accent colour ("Tools and <span>skills</span>").
  const words = section.title.split(' ');
  const last = words.pop();
  $('#section-title').replaceChildren(words.length ? `${words.join(' ')} ` : '', el('span', {}, last));
  $('#section-sub').textContent = section.subtitle || '';
  document.querySelectorAll('#nav button').forEach((b) => (b.getAttribute('data-section') === state.section ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  // Keep open/closed state of list items across re-renders.
  const open = [...document.querySelectorAll('#section-body details.item')].map((d) => d.open);
  $('#section-body').replaceChildren(el('div', { class: 'card' }, ...[section.render()].flat(2)));
  document.querySelectorAll('#section-body details.item').forEach((d, i) => (d.open = Boolean(open[i])));
}

function setContent(content) {
  state.content = content;
  state.savedJson = JSON.stringify(content);
  updateStatus();
}

// ---------- actions ----------
async function save() {
  if (state.busy || !isDirty()) return true;
  state.busy = true;
  updateStatus('Saving…', 'busy');
  try {
    const snapshotJson = JSON.stringify(state.content);
    await api('/content', { method: 'PUT', body: state.content });
    state.savedJson = snapshotJson;
    $('#messages').replaceChildren();
    return true;
  } catch (err) {
    showMessage(err.message, 'error', err.details);
    return false;
  } finally {
    state.busy = false;
    updateStatus();
  }
}

async function exportToSite() {
  if (isDirty()) {
    if (!confirm('Save your changes before exporting?')) return;
    if (!(await save())) return;
  }
  state.busy = true;
  updateStatus('Exporting…', 'busy');
  try {
    const result = await api('/export', { method: 'POST' });
    showMessage(result.changed ? 'Exported to frontend/index.html. Check the preview, then commit and push to publish.' : 'frontend/index.html is already up to date.');
  } catch (err) {
    showMessage(err.message, 'error', err.details);
  } finally {
    state.busy = false;
    updateStatus();
  }
}

// ---------- views ----------
function showLogin() {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#login-password').focus();
}

async function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  try {
    setContent(await api('/content'));
    renderSection();
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('#login-error').textContent = '';
    try {
      await api('/login', { method: 'POST', body: { password: $('#login-password').value } });
      $('#login-password').value = '';
      showApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });

  $('#nav').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-section]');
    if (!button) return;
    state.section = button.getAttribute('data-section');
    $('#messages').replaceChildren();
    renderSection();
  });

  // Light/dark toggle, shared with the portfolio through the same "theme" key.
  const syncThemeButtons = () => {
    const light = document.documentElement.classList.contains('light');
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => (b.textContent = light ? '🌙' : '☀️'));
  };
  document.querySelectorAll('[data-theme-toggle]').forEach((button) =>
    button.addEventListener('click', () => {
      const light = document.documentElement.classList.toggle('light');
      try {
        localStorage.setItem('theme', light ? 'light' : 'dark');
      } catch {
        /* ignore */
      }
      syncThemeButtons();
    }),
  );
  syncThemeButtons();

  $('#save-btn').addEventListener('click', save);
  $('#export-btn').addEventListener('click', exportToSite);
  $('#logout-btn').addEventListener('click', async () => {
    if (isDirty() && !confirm('You have unsaved changes. Log out anyway?')) return;
    await api('/logout', { method: 'POST' }).catch(() => {});
    state.content = null;
    showLogin();
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.content) {
      event.preventDefault();
      save();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (isDirty()) event.preventDefault();
  });

  try {
    const { authenticated } = await api('/session');
    if (authenticated) showApp();
    else showLogin();
  } catch {
    showLogin();
  }
});
