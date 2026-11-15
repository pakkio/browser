const { toNativePath } = require('../../lib/config');

describe('toNativePath', () => {
    test('maps /mnt/<drive> to a drive letter on Windows', () => {
        expect(toNativePath('/mnt/z', 'win32')).toBe('Z:\\');
        expect(toNativePath('/mnt/z/', 'win32')).toBe('Z:\\');
        expect(toNativePath('/mnt/d/media/books', 'win32')).toBe('D:\\media/books');
    });

    test('leaves other paths and other platforms alone', () => {
        expect(toNativePath('/mnt/z', 'linux')).toBe('/mnt/z');
        expect(toNativePath('/mnt/zz', 'win32')).toBe('/mnt/zz');
        expect(toNativePath('Z:\\', 'win32')).toBe('Z:\\');
        expect(toNativePath('.', 'win32')).toBe('.');
    });
});
