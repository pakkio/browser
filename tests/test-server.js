const express = require('express');
const { getHomogeneityModules } = require('../src/services/homogeneityService');
const { updateEntity } = require('../src/services/orthogonalityService');

const app = express();
app.use(express.json());

app.get('/api/homogeneity', (req, res) => {
  const modules = getHomogeneityModules();
  res.json({ modules });
});

app.post('/api/orthogonality', (req, res) => {
  const { name, value } = req.body;
  const result = updateEntity(name, value);
  res.json({ updated: { name, value: result } });
});

module.exports = app;

