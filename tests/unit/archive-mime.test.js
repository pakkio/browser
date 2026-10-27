const { getArchiveMimeType } = require('../../lib/config');

describe('getArchiveMimeType', () => {
    test('keeps PDF and other known types instead of defaulting to image/jpeg', () => {
        expect(getArchiveMimeType('docs/guide.PDF')).toBe('application/pdf');
        expect(getArchiveMimeType('book.epub')).toBe('application/epub+zip');
        expect(getArchiveMimeType('song.mp3')).toBe('audio/mpeg');
    });

    test('returns specific image and video types', () => {
        expect(getArchiveMimeType('page.png')).toBe('image/png');
        expect(getArchiveMimeType('page.jpg')).toBe('image/jpeg');
        expect(getArchiveMimeType('clip.webm')).toBe('video/webm');
    });

    test('returns null for unknown extensions so they get the hex dump view', () => {
        expect(getArchiveMimeType('data.bin')).toBeNull();
        expect(getArchiveMimeType('noextension')).toBeNull();
    });
});
