// SEO / AEO / GEO / LLMO generators: JSON-LD structured data and the
// crawler-facing files (robots.txt, sitemap.xml, llms.txt).
// Everything is derived from backend/content so `npm run export` keeps it current.

const fs = require('fs');
const path = require('path');
const { FRONTEND_DIR } = require('./paths');
const { esc, oneLine, absoluteUrl } = require('./html');

const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended'];
const WEB_LANGUAGES = new Set(['javascript', 'typescript', 'html', 'html5', 'css', 'css3', 'sql']);
const CODE_HOSTS = /^https?:\/\/(www\.)?(github\.com|gitlab\.com|bitbucket\.org)\//i;

// ---------- small helpers ----------
const pageTitle = (profile) => profile.seoTitle || profile.name;
const resumeUrl = (profile) => absoluteUrl(profile.siteUrl, `resume/${encodeURIComponent(profile.resumeFile)}`);
const locationText = (loc = {}) => [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
const allSkills = (skills) => [...new Set(skills.flatMap((g) => g.items))];
// "🌐 Live Demo ↗" -> "Live Demo"
const plainLabel = (label) => oneLine(label).replace(/[↗→]/g, '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
const projectUrl = (profile, p) => (p.links[0] ? absoluteUrl(profile.siteUrl, p.links[0].url) : '');

/** Programming languages of a project: its techs that are listed under a "Languages" skill group, or common web languages. */
function projectLanguages(project, skills) {
  const known = new Set(
    skills
      .filter((g) => /language/i.test(g.name))
      .flatMap((g) => g.items)
      .map((s) => s.toLowerCase()),
  );
  return project.techs.filter((t) => known.has(t.toLowerCase()) || WEB_LANGUAGES.has(t.toLowerCase()));
}

/** Pixel size of a JPEG or PNG inside frontend/, or null if it can't be read. */
function imageSize(relPath) {
  if (!relPath || /^[a-z]+:/i.test(relPath)) return null;
  let buf;
  try {
    buf = fs.readFileSync(path.join(FRONTEND_DIR, relPath));
  } catch {
    return null;
  }
  if (buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      // SOF0–SOF15 hold the frame size (C4, C8 and CC are other segment types)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** Drops empty strings, empty arrays and undefined so JSON-LD stays clean. */
function compact(value) {
  if (Array.isArray(value)) {
    const arr = value.map(compact).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([k, v]) => [k, compact(v)])
      .filter(([, v]) => v !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value === '' || value == null ? undefined : value;
}

// ---------- JSON-LD (GEO + AEO) ----------
function structuredData({ profile, projects, skills }) {
  const site = profile.siteUrl;
  const person = { '@id': `${site}#person` };
  const e = profile.education;
  const loc = profile.location || {};
  return compact({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${site}#website`, url: site, name: profile.name, inLanguage: 'en' },
      {
        '@type': 'ProfilePage',
        '@id': `${site}#profilepage`,
        url: site,
        name: pageTitle(profile),
        description: profile.seoDescription,
        inLanguage: 'en',
        isPartOf: { '@id': `${site}#website` },
        mainEntity: person,
      },
      {
        '@type': 'Person',
        ...person,
        name: profile.name,
        url: site,
        image: profile.photo ? absoluteUrl(site, profile.photo) : '',
        jobTitle: profile.jobTitle,
        description: profile.about[0],
        email: profile.email ? `mailto:${profile.email}` : '',
        address: { '@type': 'PostalAddress', addressLocality: loc.city, addressRegion: loc.region, addressCountry: loc.countryCode || loc.country },
        alumniOf: e.institution ? { '@type': 'CollegeOrUniversity', name: e.institution } : undefined,
        knowsAbout: allSkills(skills),
        sameAs: profile.socials.map((s) => s.url),
      },
      {
        '@type': 'ItemList',
        '@id': `${site}#projects`,
        name: 'Projects',
        itemListElement: projects.items.map((p, i) => {
          const repo = p.links.find((l) => CODE_HOSTS.test(l.url));
          return {
            '@type': 'ListItem',
            position: i + 1,
            item: {
              '@type': repo ? 'SoftwareSourceCode' : 'CreativeWork',
              name: p.title,
              description: p.description,
              url: projectUrl(profile, p),
              codeRepository: repo ? repo.url : '',
              programmingLanguage: repo ? projectLanguages(p, skills) : [],
              keywords: p.techs.join(', '),
              creator: person,
            },
          };
        }),
      },
      profile.faq.length
        ? {
            '@type': 'FAQPage',
            '@id': `${site}#faq`,
            url: `${site}#faq`,
            isPartOf: { '@id': `${site}#website` },
            mainEntity: profile.faq.map((f) => ({
              '@type': 'Question',
              name: oneLine(f.question),
              acceptedAnswer: { '@type': 'Answer', text: oneLine(f.answer) },
            })),
          }
        : undefined,
    ],
  });
}

// ---------- crawler / LLM files ----------
const md = (s) => oneLine(s).replace(/([[\]])/g, '\\$1');

function quickFacts(profile, experience) {
  const e = profile.education;
  const current = experience.find((x) => /present|ongoing/i.test(`${x.period} ${x.badge}`));
  return [
    profile.jobTitle && `- Role: ${md(profile.jobTitle)}`,
    current && `- Current position: ${md(current.role)}${current.company ? `, ${md(current.company)}` : ''}`,
    locationText(profile.location) && `- Location: ${md(locationText(profile.location))}`,
    e.degree && `- Education: ${md(e.degree)}, ${md(e.institution)} (${md(e.startYear)}–${md(e.endYear)})${e.cgpa ? `, CGPA ${md(e.cgpa)}${e.cgpaScale ? `/${md(e.cgpaScale)}` : ''}` : ''}`,
  ].filter(Boolean);
}

function contactLines(profile) {
  return [
    profile.email && `- Email: ${md(profile.email)}`,
    `- [Contact form](${absoluteUrl(profile.siteUrl, '#contact')})`,
    `- [Resume (PDF)](${resumeUrl(profile)})`,
    ...profile.socials.map((s) => `- [${md(s.label)}](${s.url})`),
  ].filter(Boolean);
}

const generatedFiles = {
  // Allows regular and AI crawlers explicitly and points to the sitemap.
  'robots.txt': ({ profile }) =>
    [
      'User-agent: *',
      'Allow: /',
      '',
      '# AI search engines and assistants are welcome to read and cite this site.',
      ...AI_CRAWLERS.flatMap((bot) => [`User-agent: ${bot}`, 'Allow: /', '']),
      `Sitemap: ${absoluteUrl(profile.siteUrl, 'sitemap.xml')}`,
      '',
    ].join('\n'),

  'sitemap.xml': ({ profile }, { lastmod }) =>
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      `  <url><loc>${esc(profile.siteUrl)}</loc><lastmod>${esc(lastmod)}</lastmod><priority>1.0</priority></url>`,
      `  <url><loc>${esc(resumeUrl(profile))}</loc><priority>0.6</priority></url>`,
      '</urlset>',
      '',
    ].join('\n'),

  // llms.txt (https://llmstxt.org): the whole portfolio as Markdown for LLMs
  // and answer engines. One file is enough for a single-page site.
  'llms.txt': ({ profile, projects, experience, skills }) =>
    [
      `# ${md(profile.name)}`,
      '',
      `> ${md(profile.seoDescription)}`,
      '',
      '## About',
      '',
      ...profile.about.flatMap((p) => [oneLine(p), '']),
      ...quickFacts(profile, experience),
      `- Website: ${profile.siteUrl}`,
      '',
      '## Experience',
      '',
      ...experience.flatMap((x) => [
        `### ${md(x.role)}${x.company ? ` — ${md(x.company)}` : ''}${x.period ? ` (${md(x.period)})` : ''}`,
        '',
        ...x.points.map((pt) => `- ${md(pt)}`),
        ...(x.tags.length ? ['', `Skills: ${x.tags.map(md).join(', ')}`] : []),
        '',
      ]),
      '## Projects',
      '',
      ...projects.items.flatMap((p) => [
        `### ${md(p.title)}${p.date ? ` (${md(p.date)})` : ''}`,
        '',
        md(p.description),
        '',
        ...(p.techs.length ? [`Technologies: ${p.techs.map(md).join(', ')}`] : []),
        ...p.links.map((l) => `- [${md(plainLabel(l.label))}](${absoluteUrl(profile.siteUrl, l.url)})`),
        ...(p.note ? [`Note: ${md(p.note)}`] : []),
        '',
      ]),
      '## Skills',
      '',
      ...skills.map((g) => `- ${md(g.name)}: ${g.items.map(md).join(', ')}`),
      '',
      ...(profile.faq.length ? ['## Frequently asked questions', '', ...profile.faq.flatMap((f) => [`### ${md(f.question)}`, '', md(f.answer), '']) ] : []),
      '## Contact',
      '',
      ...contactLines(profile),
      '',
    ].join('\n'),
};

module.exports = { structuredData, generatedFiles, imageSize, pageTitle, resumeUrl, allSkills, locationText };
