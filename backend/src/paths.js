const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(BACKEND_DIR, '..');
const FRONTEND_DIR = path.join(REPO_DIR, 'frontend');

module.exports = {
  BACKEND_DIR,
  REPO_DIR,
  FRONTEND_DIR,
  CONTENT_DIR: path.join(BACKEND_DIR, 'content'),
  HISTORY_DIR: path.join(BACKEND_DIR, 'content', '.history'),
  ADMIN_DIR: path.join(BACKEND_DIR, 'admin'),
  INDEX_HTML: path.join(FRONTEND_DIR, 'index.html'),
  RESUME_DIR: path.join(FRONTEND_DIR, 'resume'),
};
