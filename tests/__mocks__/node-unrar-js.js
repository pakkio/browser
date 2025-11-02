module.exports = {
  createExtractorFromFile: (filePath, options = {}) => {
    return {
      extract: async (args = {}) => ({ files: [], warnings: [], errors: [] })
    };
  }
};
