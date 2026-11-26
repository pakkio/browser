// Parity tests: real Node and Rust servers side by side (no mocks). See tests/parity/.
module.exports = {
  testMatch: ['**/tests/parity/**/*.test.js'],
  testEnvironment: 'node',
  verbose: true,
};
