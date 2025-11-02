const Orthogonality = require('../models/orthogonality');

function updateEntity(name, value) {
  // Update entity in an isolated manner
  const entities = { A: 1, B: 2 };
  const model = new Orthogonality(entities);
  model.updateEntity(name, value);
  return model.getEntity(name);
}

module.exports = { updateEntity };
