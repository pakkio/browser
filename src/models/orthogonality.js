// Orthogonality model: ensures separation of concerns
class Orthogonality {
  constructor(entities) {
    this.entities = entities;
  }
  updateEntity(name, value) {
    this.entities[name] = value;
  }
  getEntity(name) {
    return this.entities[name];
  }
}
module.exports = Orthogonality;

