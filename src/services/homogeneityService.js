const Homogeneity = require('../models/homogeneity');

function getHomogeneityModules() {
  // Example: return consistent module list
  const modules = ['auth', 'cache', 'file', 'media'];
  const model = new Homogeneity(modules);
  return model.getModules();
}

module.exports = { getHomogeneityModules };

