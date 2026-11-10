// Reads and writes backend/content/*.json and keeps snapshots in content/.history.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONTENT_DIR, HISTORY_DIR } = require('./paths');
const { validateContent } = require('./validate');

const SECTIONS = ['site', 'profile', 'projects', 'experience', 'skills'];
const MAX_SNAPSHOTS = 50;
const SNAPSHOT_ID = /^[0-9TZ-]+-[a-f0-9]{6}$/;

const fileFor = (section) => path.join(CONTENT_DIR, `${section}.json`);

function readSection(section) {
  return JSON.parse(fs.readFileSync(fileFor(section), 'utf8'));
}

function readAll() {
  return Object.fromEntries(SECTIONS.map((s) => [s, readSection(s)]));
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function snapshot(reason) {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(HISTORY_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const s of SECTIONS) fs.copyFileSync(fileFor(s), path.join(dir, `${s}.json`));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ createdAt: new Date().toISOString(), reason }, null, 2));
  pruneHistory();
  return id;
}

function listHistory() {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  return fs
    .readdirSync(HISTORY_DIR)
    .filter((id) => SNAPSHOT_ID.test(id))
    .map((id) => {
      let meta = {};
      try {
        meta = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, id, 'meta.json'), 'utf8'));
      } catch {
        /* snapshot without metadata: still restorable */
      }
      return { id, createdAt: meta.createdAt || null, reason: meta.reason || '' };
    })
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

function pruneHistory() {
  for (const old of listHistory().slice(MAX_SNAPSHOTS)) {
    fs.rmSync(path.join(HISTORY_DIR, old.id), { recursive: true, force: true });
  }
}

class ValidationError extends Error {
  constructor(errors) {
    super(`Content is invalid:\n- ${errors.join('\n- ')}`);
    this.errors = errors;
  }
}

/** Validates, snapshots the current files, then writes every section. */
function saveAll(content, reason = 'Save from admin') {
  const next = Object.fromEntries(SECTIONS.map((s) => [s, content[s]]));
  const errors = validateContent(next);
  if (errors.length) throw new ValidationError(errors);
  const current = readAll();
  if (JSON.stringify(current) === JSON.stringify(next)) return { changed: false, snapshotId: null };
  const snapshotId = snapshot(reason);
  for (const s of SECTIONS) writeJsonAtomic(fileFor(s), next[s]);
  return { changed: true, snapshotId };
}

function restoreSnapshot(id) {
  if (!SNAPSHOT_ID.test(id)) return null;
  const dir = path.join(HISTORY_DIR, id);
  if (!fs.existsSync(dir)) return null;
  // Snapshots taken before a section existed (e.g. site.json) keep the current file for it.
  const restored = Object.fromEntries(
    SECTIONS.map((s) => {
      const file = path.join(dir, `${s}.json`);
      return [s, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : readSection(s)];
    }),
  );
  return saveAll(restored, `Before restoring snapshot ${id}`);
}

module.exports = { SECTIONS, readSection, readAll, saveAll, listHistory, restoreSnapshot, ValidationError };
