#!/usr/bin/env node
// Validates the exported site for SEO / AEO / GEO / LLMO. Run after `npm run export`:
//   npm run seo:check
// Prints a PASS / WARN / FAIL report and exits 1 if anything failed.

const fs = require('fs');
const path = require('path');
const { FRONTEND_DIR, INDEX_HTML } = require('./paths');
const { readAll } = require('./content');
const { exportSite } = require('./export');

const results = [];
const pass = (msg) => results.push(['PASS', msg]);
const warn = (msg) => results.push(['WARN', msg]);
const fail = (msg) => results.push(['FAIL', msg]);
const check = (ok, msg, detail = '') => (ok ? pass(msg) : fail(detail ? `${msg} — ${detail}` : msg));

const decode = (s) =>
  String(s ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => attrs(m[0].slice(name.length + 1)));
const textOf = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** fs.existsSync that also respects letter case (Vercel runs on case-sensitive Linux). */
function existsExact(relPath) {
  let dir = FRONTEND_DIR;
  for (const part of relPath.split('/').filter(Boolean)) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory() || !fs.readdirSync(dir).includes(part)) return false;
    dir = path.join(dir, part);
  }
  return true;
}
const readFrontend = (name) => (existsExact(name) ? fs.readFileSync(path.join(FRONTEND_DIR, name), 'utf8') : null);

function run() {
  const content = readAll();
  const { profile } = content;

  // ---------- export is current ----------
  try {
    const { changed, files } = exportSite({ check: true, content });
    check(!changed, 'Export is up to date with backend/content', `run npm run export (stale: ${files.join(', ')})`);
  } catch (err) {
    fail(`Export failed: ${err.message}`);
  }

  const raw = fs.readFileSync(INDEX_HTML, 'utf8');
  const html = raw.replace(/<!--[\s\S]*?-->/g, ''); // ignore commented-out markup
  const head = (html.match(/<head>([\s\S]*?)<\/head>/i) || [])[1] || '';
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || '';

  // ---------- title + description ----------
  const title = textOf((head.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
  check(title.length > 0, `<title> present ("${title}")`);
  if (title.length > 60) warn(`<title> is ${title.length} characters; Google may cut it after ~60`);
  const metas = tags(head, 'meta');
  const meta = (key) => metas.find((m) => m.name === key || m.property === key);
  const description = meta('description')?.content || '';
  check(description.length >= 150 && description.length <= 160, `Meta description is 150–160 characters (${description.length})`);

  // ---------- required tags ----------
  const links = tags(head, 'link');
  check(links.some((l) => l.rel === 'canonical' && l.href === profile.siteUrl), 'Canonical URL matches siteUrl');
  const required = ['robots', 'author', 'theme-color', 'og:type', 'og:url', 'og:title', 'og:description', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt', 'og:site_name', 'og:locale', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'];
  const missing = required.filter((k) => !meta(k)?.content);
  check(missing.length === 0, `All ${required.length} required meta tags present`, `missing: ${missing.join(', ')}`);
  check(meta('robots')?.content === 'index, follow', 'robots meta is "index, follow"');
  check(meta('og:locale')?.content === 'en_IN', 'og:locale is en_IN');
  check(meta('twitter:card')?.content === 'summary_large_image', 'twitter:card is summary_large_image');
  const ogPath = profile.ogImage && !/^https?:/i.test(profile.ogImage) ? profile.ogImage : null;
  if (ogPath) check(existsExact(ogPath), `og:image file exists (${ogPath})`);

  // ---------- JSON-LD ----------
  const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  check(ldBlocks.length === 1, `Exactly one JSON-LD block (${ldBlocks.length})`);
  let graph = [];
  try {
    const data = JSON.parse(ldBlocks[0]);
    graph = data['@graph'] || [];
    pass('JSON-LD parses');
  } catch (err) {
    fail(`JSON-LD does not parse: ${err.message}`);
  }
  if (ldBlocks[0]) check(!ldBlocks[0].includes('</'), 'JSON-LD contains no raw "</"');
  const byType = (t) => graph.find((n) => n['@type'] === t);
  for (const t of ['Person', 'WebSite', 'ProfilePage', 'ItemList', 'FAQPage']) check(Boolean(byType(t)), `JSON-LD has ${t}`);
  const person = byType('Person') || {};
  const personMissing = ['name', 'jobTitle', 'description', 'url', 'image', 'email', 'address', 'alumniOf', 'knowsAbout', 'sameAs'].filter((k) => !person[k]);
  check(personMissing.length === 0, 'Person has all key properties', `missing: ${personMissing.join(', ')}`);
  check(byType('ProfilePage')?.mainEntity?.['@id'] === person['@id'], 'ProfilePage.mainEntity points to Person');
  const faqSchema = (byType('FAQPage')?.mainEntity || []).map((q) => q.name);

  // ---------- visible FAQ matches schema ----------
  const visibleFaq = [...body.matchAll(/<details class="faq-item[^"]*">\s*<summary><h3>([\s\S]*?)<\/h3><\/summary>/gi)].map((m) => textOf(m[1]));
  check(visibleFaq.length >= 5 && visibleFaq.length <= 8, `Visible FAQ has 5–8 questions (${visibleFaq.length})`);
  check(JSON.stringify(visibleFaq) === JSON.stringify(faqSchema), 'Visible FAQ matches FAQPage structured data');
  const firstAbout = textOf((body.match(/<section id="about">[\s\S]*?<p>([\s\S]*?)<\/p>/i) || [])[1] || '');
  check(firstAbout.startsWith(`${profile.name} is `), 'About starts with a direct "Who is …" answer');

  // ---------- headings ----------
  const h1s = body.match(/<h1\b/gi) || [];
  check(h1s.length === 1, `Exactly one <h1> (${h1s.length})`);
  let prev = 1;
  const skips = [];
  for (const m of body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const level = Number(m[1]);
    if (level > prev + 1) skips.push(`h${prev}→h${level} "${textOf(m[2])}"`);
    prev = level;
  }
  check(skips.length === 0, 'Headings never skip a level', skips.join('; '));

  // ---------- menu links point at real sections ----------
  const ids = new Set([...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const deadNav = (content.site.nav || []).filter((n) => !ids.has(n.id)).map((n) => `#${n.id}`);
  check(deadNav.length === 0, 'Every menu link points to a section on the page', deadNav.join(', '));

  // ---------- images ----------
  const imgs = tags(body, 'img');
  const noAlt = imgs.filter((i) => !i.alt || !i.alt.trim());
  check(imgs.length > 0 && noAlt.length === 0, `All ${imgs.length} images have alt text`, noAlt.map((i) => i.src).join(', '));
  const noSize = imgs.filter((i) => !i.width || !i.height);
  check(noSize.length === 0, 'All images have width and height', noSize.map((i) => i.src).join(', '));
  const eagerBelowFold = imgs.slice(1).filter((i) => i.loading !== 'lazy');
  check(eagerBelowFold.length === 0, 'Below-the-fold images use loading="lazy"', eagerBelowFold.map((i) => i.src).join(', '));
  const brokenImgs = imgs.filter((i) => i.src && !/^(https?:|data:)/i.test(i.src) && !existsExact(i.src));
  check(brokenImgs.length === 0, 'All image files exist (exact letter case)', brokenImgs.map((i) => i.src).join(', '));

  // ---------- performance ----------
  const blockingScripts = tags(html, 'script').filter((s) => s.src && !('defer' in s) && !('async' in s));
  check(blockingScripts.length === 0, 'No render-blocking scripts (all use defer/async)', blockingScripts.map((s) => s.src).join(', '));
  const fontLinks = links.filter((l) => /fonts\.googleapis\.com\/css/.test(l.href || ''));
  check(fontLinks.every((l) => /display=swap/.test(l.href)), 'Google Fonts use display=swap');
  check(links.some((l) => l.rel === 'preconnect' && /fonts\.gstatic\.com/.test(l.href)), 'Preconnect to fonts.gstatic.com');
  check(fontLinks.some((l) => l.rel === 'stylesheet' && l.media === 'print'), 'Font stylesheet does not block first paint');

  // ---------- analytics ----------
  const gaScript = tags(html, 'script').find((s) => s['data-ga-id']);
  if (profile.gaId) {
    check(gaScript?.['data-ga-id'] === profile.gaId, 'GA4 script present with gaId from profile.json');
    check(/class="footer-analytics"/.test(body), 'Footer analytics notice present');
    check(existsExact('js/analytics.js'), 'js/analytics.js exists');
    if (/^G-X+$/i.test(profile.gaId)) warn(`gaId is the placeholder ${profile.gaId}; set your real GA4 ID in Site & SEO`);
  } else {
    check(!gaScript, 'No GA script when gaId is empty');
  }

  // ---------- resume ----------
  check(existsExact(`resume/${profile.resumeFile}`), `Resume file exists with exact name (resume/${profile.resumeFile})`);

  // ---------- crawler / LLM files ----------
  const sitemap = readFrontend('sitemap.xml');
  check(Boolean(sitemap), 'sitemap.xml exists');
  if (sitemap) {
    check(sitemap.includes(`<loc>${profile.siteUrl}</loc>`) && /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sitemap), 'sitemap.xml lists the homepage with lastmod');
  }
  const robots = readFrontend('robots.txt');
  check(Boolean(robots), 'robots.txt exists');
  if (robots) {
    const bots = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'].filter((b) => !robots.includes(`User-agent: ${b}`));
    check(bots.length === 0, 'robots.txt allows GPTBot, ClaudeBot, PerplexityBot, Google-Extended', `missing: ${bots.join(', ')}`);
    check(/^Sitemap: https?:\/\/\S+sitemap\.xml$/m.test(robots), 'robots.txt has a Sitemap line');
  }
  const llms = readFrontend('llms.txt');
  check(Boolean(llms), 'llms.txt exists');
  if (llms) {
    check(/^# .+\n\n> .+/.test(llms), 'llms.txt starts with "# Name" and "> summary"');
    const sections = ['About', 'Experience', 'Projects', 'Skills', 'Contact'].filter((s) => !llms.includes(`\n## ${s}\n`));
    check(sections.length === 0, 'llms.txt has About, Experience, Projects, Skills, Contact', `missing: ${sections.join(', ')}`);
  }
  try {
    JSON.parse(readFrontend('vercel.json'));
    pass('vercel.json parses');
  } catch {
    fail('vercel.json is missing or invalid JSON');
  }
}

try {
  run();
} catch (err) {
  fail(`seo:check crashed: ${err.message}`);
}

const colour = { PASS: '\x1b[32m', WARN: '\x1b[33m', FAIL: '\x1b[31m' };
const useColour = process.stdout.isTTY;
for (const [status, msg] of results) console.log(`${useColour ? colour[status] : ''}${status}${useColour ? '\x1b[0m' : ''}  ${msg}`);
const count = (s) => results.filter((r) => r[0] === s).length;
console.log(`\n${count('PASS')} passed, ${count('WARN')} warnings, ${count('FAIL')} failed`);
process.exitCode = count('FAIL') ? 1 : 0;
