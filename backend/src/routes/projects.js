const express = require('express');
const { readSection } = require('../content');

const router = express.Router();

// Read on every request so edits from the admin panel show up immediately.
router.get('/', (req, res) => {
  res.json(readSection('projects').items);
});

router.get('/:id', (req, res) => {
  const project = readSection('projects').items.find((p) => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

module.exports = router;
