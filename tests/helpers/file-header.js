// Make fs.openSync/readSync/closeSync serve fixed header bytes, matching how
// comic-handlers reads magic numbers (it no longer reads whole files)
const fs = require('fs');

const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function mockFileHeader(bytes = ZIP_HEADER) {
  jest.spyOn(fs, 'openSync').mockReturnValue(99);
  jest.spyOn(fs, 'readSync').mockImplementation((fd, buffer) => bytes.copy(buffer));
  jest.spyOn(fs, 'closeSync').mockReturnValue(undefined);
}

function restoreFileHeader() {
  fs.openSync.mockRestore();
  fs.readSync.mockRestore();
  fs.closeSync.mockRestore();
}

module.exports = { mockFileHeader, restoreFileHeader, ZIP_HEADER };
