// Small escaping / formatting helpers shared by export.js, seo.js and seo-check.js.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML/XML-escape a value for text or a double-quoted attribute. */
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/** Text inside an HTML comment: "--" can't be allowed to end it early. */
const commentText = (value) => esc(value).replace(/-{2,}/g, '-');

/** Collapses whitespace/newlines into single spaces. */
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * JSON for an inline <script> block. HTML entities aren't decoded inside
 * <script>, so the safe escaping is \u003c etc. — this also turns every "</"
 * into "\u003c/", so the data can never close the tag.
 */
const jsonForScript = (data) =>
  JSON.stringify(data, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

function absoluteUrl(siteUrl, value) {
  if (!value) return '';
  try {
    return new URL(value, siteUrl).href;
  } catch {
    return value;
  }
}

module.exports = { esc, commentText, oneLine, jsonForScript, absoluteUrl };
