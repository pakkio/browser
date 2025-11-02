module.exports = {
  testMatch: ["**/tests/**/*.test.js"],
  testEnvironment: "node",
  verbose: true,
  moduleNameMapper: {
    '^pdfjs-dist/legacy/build/pdf\\.mjs$': '<rootDir>/tests/__mocks__/pdfjs-mock.js',
    '^pdf2pic$': '<rootDir>/tests/__mocks__/pdf2pic.js',
    '^node-unrar-js$': '<rootDir>/tests/__mocks__/node-unrar-js.js'
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'server.js',
    'public/script.js',
    '!node_modules/**'
  ],
  setupFiles: ['<rootDir>/tests/setup-jest.js']
};
