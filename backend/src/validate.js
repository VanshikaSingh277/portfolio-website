// Shape and safety checks for the content JSON files. Used by the admin save
// endpoint and by export.js so bad data never reaches index.html.

const CATEGORY_ID = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/; // used inside an onclick JS string
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const RESUME_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.pdf$/i;
const CSS_BACKGROUND = /^[^;{}<>"'\\]*$/; // rendered inside style="background:..."

function isSafeUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  // Browsers strip surrounding whitespace and embedded tabs/newlines before
  // reading the scheme, so " javascript:" or "java\tscript:" would slip past
  // the check below. Reject those outright.
  // eslint-disable-next-line no-control-regex
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (/^(https?:|mailto:)/i.test(value)) return true;
  // relative paths are fine as long as they have no scheme (blocks javascript:, data:, etc.)
  return !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('//');
}

function createChecker() {
  const errors = [];
  const str = (value, where, { required = false, max = 2000 } = {}) => {
    if (typeof value !== 'string') return errors.push(`${where} must be a string`);
    if (required && value.trim() === '') return errors.push(`${where} is required`);
    if (value.length > max) errors.push(`${where} is longer than ${max} characters`);
  };
  const strList = (value, where, opts) => {
    if (!Array.isArray(value)) return errors.push(`${where} must be a list`);
    value.forEach((v, i) => str(v, `${where}[${i}]`, { required: true, ...opts }));
  };
  const list = (value, where) => {
    if (!Array.isArray(value)) {
      errors.push(`${where} must be a list`);
      return [];
    }
    return value;
  };
  const obj = (value, where) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${where} must be an object`);
      return {};
    }
    return value;
  };
  return { errors, str, strList, list, obj };
}

function validateProfile(profile, c) {
  const p = c.obj(profile, 'profile');
  c.str(p.name, 'profile.name', { required: true, max: 100 });
  c.str(p.tagline, 'profile.tagline', { max: 300 });
  c.str(p.seoDescription, 'profile.seoDescription', { max: 300 });
  c.str(p.siteUrl, 'profile.siteUrl', { required: true, max: 300 });
  if (typeof p.siteUrl === 'string' && !/^https?:\/\//i.test(p.siteUrl)) c.errors.push('profile.siteUrl must start with http:// or https://');
  // Relative links (resume, images, sitemap) are resolved against siteUrl;
  // without the trailing slash the last path segment would be dropped.
  if (typeof p.siteUrl === 'string' && !p.siteUrl.endsWith('/')) c.errors.push('profile.siteUrl must end with /');
  c.str(p.jobTitle, 'profile.jobTitle', { max: 100 });
  c.str(p.seoTitle, 'profile.seoTitle', { max: 120 });
  c.str(p.email, 'profile.email', { max: 254 });
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) c.errors.push('profile.email is not a valid email address');
  const loc = c.obj(p.location, 'profile.location');
  for (const key of ['city', 'region', 'country']) c.str(loc[key], `profile.location.${key}`, { max: 100 });
  c.list(p.socials, 'profile.socials').forEach((s, i) => {
    const where = `profile.socials[${i}]`;
    const o = c.obj(s, where);
    c.str(o.label, `${where}.label`, { required: true, max: 60 });
    c.str(o.url, `${where}.url`, { required: true, max: 300 });
    if (typeof o.url === 'string' && !/^https:\/\//i.test(o.url)) c.errors.push(`${where}.url must start with https://`);
  });
  for (const key of ['photo', 'ogImage']) {
    c.str(p[key], `profile.${key}`, { max: 300 });
    if (p[key] && !isSafeUrl(p[key])) c.errors.push(`profile.${key} is not a valid URL or path`);
  }
  c.str(p.ogImageAlt, 'profile.ogImageAlt', { max: 200 });
  c.str(p.photoAlt, 'profile.photoAlt', { max: 200 });
  c.str(p.phone, 'profile.phone', { max: 30 });
  if (p.phone && !/^\+?[0-9 ()-]{6,30}$/.test(p.phone)) c.errors.push('profile.phone may only contain digits, spaces, +, ( ) and -');
  c.str(loc.countryCode, 'profile.location.countryCode', { max: 2 });
  if (loc.countryCode && !/^[A-Z]{2}$/.test(loc.countryCode)) c.errors.push('profile.location.countryCode must be a 2-letter code like IN');
  c.str(p.themeColor, 'profile.themeColor', { max: 7 });
  if (p.themeColor && !/^#[0-9a-fA-F]{6}$/.test(p.themeColor)) c.errors.push('profile.themeColor must be a hex colour like #0a0d14');
  c.str(p.gaId, 'profile.gaId', { max: 20 });
  if (p.gaId && !/^G-[A-Z0-9]{4,16}$/.test(p.gaId)) c.errors.push('profile.gaId must look like G-XXXXXXXXXX (or be empty to turn analytics off)');
  c.list(p.faq, 'profile.faq').forEach((item, i) => {
    const where = `profile.faq[${i}]`;
    const o = c.obj(item, where);
    c.str(o.question, `${where}.question`, { required: true, max: 200 });
    c.str(o.answer, `${where}.answer`, { required: true, max: 1000 });
  });
  c.strList(p.about, 'profile.about', { max: 3000 });
  const e = c.obj(p.education, 'profile.education');
  for (const key of ['degree', 'degreeShort', 'institution', 'institutionShort', 'startYear', 'endYear', 'location', 'cgpa', 'cgpaScale']) {
    c.str(e[key], `profile.education.${key}`, { max: 200 });
  }
  c.str(p.resumeFile, 'profile.resumeFile', { required: true, max: 104 });
  if (typeof p.resumeFile === 'string' && !RESUME_FILE.test(p.resumeFile)) {
    c.errors.push('profile.resumeFile must be a plain .pdf file name (letters, numbers, . _ -)');
  }
}

function validateProjects(projects, c) {
  const p = c.obj(projects, 'projects');
  const categoryIds = new Set();
  c.list(p.categories, 'projects.categories').forEach((cat, i) => {
    const where = `projects.categories[${i}]`;
    const o = c.obj(cat, where);
    c.str(o.id, `${where}.id`, { required: true, max: 40 });
    c.str(o.label, `${where}.label`, { required: true, max: 60 });
    if (typeof o.id === 'string' && !CATEGORY_ID.test(o.id)) c.errors.push(`${where}.id may only use letters, numbers, spaces, _ and -`);
    if (categoryIds.has(o.id)) c.errors.push(`${where}.id "${o.id}" is duplicated`);
    categoryIds.add(o.id);
  });
  const ids = new Set();
  c.list(p.items, 'projects.items').forEach((item, i) => {
    const where = `projects.items[${i}]`;
    const o = c.obj(item, where);
    c.str(o.id, `${where}.id`, { required: true, max: 80 });
    if (typeof o.id === 'string' && !PROJECT_ID.test(o.id)) c.errors.push(`${where}.id must be lowercase letters, numbers and dashes`);
    if (ids.has(o.id)) c.errors.push(`${where}.id "${o.id}" is duplicated`);
    ids.add(o.id);
    c.str(o.title, `${where}.title`, { required: true, max: 120 });
    c.str(o.category, `${where}.category`, { required: true, max: 40 });
    if (typeof o.category === 'string' && !categoryIds.has(o.category)) c.errors.push(`${where}.category "${o.category}" is not one of the project categories`);
    for (const key of ['date', 'thumbText', 'thumbLabel', 'icon', 'thumbBackground', 'note']) c.str(o[key], `${where}.${key}`, { max: 200 });
    if (typeof o.thumbBackground === 'string' && !CSS_BACKGROUND.test(o.thumbBackground)) c.errors.push(`${where}.thumbBackground contains characters that are not allowed (; { } < > " ' \\)`);
    c.str(o.description, `${where}.description`, { max: 2000 });
    c.strList(o.techs, `${where}.techs`, { max: 60 });
    c.list(o.links, `${where}.links`).forEach((link, j) => {
      const lw = `${where}.links[${j}]`;
      const l = c.obj(link, lw);
      c.str(l.label, `${lw}.label`, { required: true, max: 100 });
      c.str(l.url, `${lw}.url`, { required: true, max: 500 });
      if (typeof l.url === 'string' && l.url && !isSafeUrl(l.url)) c.errors.push(`${lw}.url must be an http(s), mailto or relative link`);
    });
  });
}

function validateExperience(experience, c) {
  c.list(experience, 'experience').forEach((item, i) => {
    const where = `experience[${i}]`;
    const o = c.obj(item, where);
    c.str(o.role, `${where}.role`, { required: true, max: 150 });
    for (const key of ['period', 'icon', 'company', 'badge']) c.str(o[key], `${where}.${key}`, { max: 200 });
    c.strList(o.points, `${where}.points`, { max: 500 });
    c.strList(o.tags, `${where}.tags`, { max: 60 });
  });
}

function validateSkills(skills, c) {
  c.list(skills, 'skills').forEach((group, i) => {
    const where = `skills[${i}]`;
    const o = c.obj(group, where);
    c.str(o.name, `${where}.name`, { required: true, max: 80 });
    c.str(o.icon, `${where}.icon`, { max: 20 });
    c.strList(o.items, `${where}.items`, { max: 80 });
  });
}

const SITE_TEXT = {
  hero: ['resumeButton', 'scrollButton'],
  about: ['cardIcon', 'cardTitle'],
  projects: ['filterLabel', 'categoriesTitle', 'allLabel'],
  contact: ['title', 'intro', 'namePlaceholder', 'emailPlaceholder', 'messagePlaceholder', 'submitButton', 'successMessage'],
  footer: ['tagline', 'linksTitle', 'connectTitle', 'connectText', 'connectButton'],
};
const HEADINGS = ['about', 'skills', 'projects', 'experience', 'faq', 'contact'];
const SECTION_ID = /^[a-z][a-z0-9-]{0,39}$/;

/** site.json: page wording (nav, headings, buttons, form, footer). */
function validateSite(site, c) {
  const s = c.obj(site, 'site');
  c.str(s.logo, 'site.logo', { required: true, max: 60 });
  c.list(s.nav, 'site.nav').forEach((item, i) => {
    const where = `site.nav[${i}]`;
    const o = c.obj(item, where);
    c.str(o.id, `${where}.id`, { required: true, max: 40 });
    if (typeof o.id === 'string' && !SECTION_ID.test(o.id)) c.errors.push(`${where}.id must be a section id like "about"`);
    c.str(o.label, `${where}.label`, { required: true, max: 40 });
  });
  const h = c.obj(s.headings, 'site.headings');
  for (const key of HEADINGS) {
    const o = c.obj(h[key], `site.headings.${key}`);
    c.str(o.text, `site.headings.${key}.text`, { max: 60 });
    c.str(o.highlight, `site.headings.${key}.highlight`, { max: 60 });
  }
  for (const [group, keys] of Object.entries(SITE_TEXT)) {
    const o = c.obj(s[group], `site.${group}`);
    for (const key of keys) c.str(o[key], `site.${group}.${key}`, { required: true, max: 500 });
  }
}

/** Returns a list of human-readable problems; empty means valid. */
function validateContent(content) {
  const c = createChecker();
  validateSite(content.site, c);
  validateProfile(content.profile, c);
  validateProjects(content.projects, c);
  validateExperience(content.experience, c);
  validateSkills(content.skills, c);
  return c.errors;
}

module.exports = { validateContent, isSafeUrl, RESUME_FILE };
