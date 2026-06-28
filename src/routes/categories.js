const express = require('express');

const router = express.Router();

// Hard-coded categories for now; you can later load from PostgreSQL if you want.
const categories = [
  {
    id: 'screen',
    name: 'Screen issues',
    description: 'Broken or unresponsive display',
  },
  {
    id: 'battery',
    name: 'Battery issues',
    description: 'Draining fast, not charging, or overheating',
  },
  {
    id: 'charging',
    name: 'Charging issues',
    description: 'Port loose, cable not detected, slow charging',
  },
  {
    id: 'other',
    name: 'Other issues',
    description: 'Anything else with your phone',
  },
];

// GET /api/categories
router.get('/', (req, res) => {
  return res.json({
    success: true,
    categories,
  });
});

module.exports = router;