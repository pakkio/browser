// jest.fn so tests can override the extractor per call (mockResolvedValueOnce)
module.exports = {
  createExtractorFromFile: jest.fn(async () => ({
    getFileList: async () => ({ fileHeaders: [] }),
    extract: async () => ({ files: [], warnings: [], errors: [] })
  }))
};
