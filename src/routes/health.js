// src/routes/health.js
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'OK',
    data: { uptime: process.uptime() },
  });
});

module.exports = router;