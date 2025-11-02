module.exports = {
  fromPath: (filePath, options) => {
    return async (page, { responseType } = {}) => {
      const base64 = Buffer.from('mock-image-bytes').toString('base64');
      return { base64 };
    };
  }
};

