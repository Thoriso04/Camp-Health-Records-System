const { buildPhotoIndex, resolvePhoto, inspectImageDataUrl, MAX_PHOTO_BYTES } = require('../electron/services/registrationPhotos');

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const png = `data:image/png;base64,${PNG_1X1}`;
const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF fake body for signature test')]);
const jpeg = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`;
const webpBytes = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8 padding')]);
const webp = `data:image/webp;base64,${webpBytes.toString('base64')}`;

describe('registration photo resolver', () => {
  describe('no photo means blank', () => {
    it.each([[undefined], [null], [''], ['   '], ['\n']])('treats %p as no photo', (cell) => {
      expect(resolvePhoto(cell)).toEqual({ dataUrl: null, status: 'none', message: 'No photo' });
    });

    it('never returns an image unless one was positively resolved', () => {
      const index = buildPhotoIndex({ 'thandi.jpg': jpeg });
      const failures = [
        'sipho.jpg',                                   // not among the chosen photos
        'https://drive.google.com/open?id=abc123',     // a link
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',  // svg
        'data:image/png;base64,AAAA',                  // not really a PNG
        'data:text/html;base64,PGgxPmhpPC9oMT4=',      // not an image
        'thandi.png',                                  // wrong extension for the file that exists
        '../../etc/passwd',
      ];
      for (const cell of failures) {
        const result = resolvePhoto(cell, index);
        expect(result.dataUrl).toBeNull();
        expect(result.status).not.toBe('none');
        expect(result.message).toMatch(/photo/i);
      }
    });
  });

  describe('file names', () => {
    const files = { 'Thandi Nkosi.JPG': jpeg, 'sipho.png': png };
    const index = buildPhotoIndex(files);

    it('matches case-insensitively and ignores folders in the cell', () => {
      expect(resolvePhoto('thandi nkosi.jpg', index)).toMatchObject({ dataUrl: jpeg, status: 'matched' });
      expect(resolvePhoto('C:\\Users\\me\\Photos\\SIPHO.PNG', index)).toMatchObject({ dataUrl: png, status: 'matched' });
      expect(resolvePhoto('  photos/Sipho.png ', index)).toMatchObject({ dataUrl: png, status: 'matched' });
    });

    it('matches a name without an extension only when exactly one file has it', () => {
      expect(resolvePhoto('sipho', index)).toMatchObject({ dataUrl: png, status: 'matched' });

      const twins = buildPhotoIndex({ 'sipho.png': png, 'sipho.jpg': jpeg });
      expect(resolvePhoto('sipho', twins)).toMatchObject({ dataUrl: null, status: 'ambiguous' });
      expect(resolvePhoto('sipho.jpg', twins)).toMatchObject({ dataUrl: jpeg, status: 'matched' });
    });

    it('never guesses from similar names', () => {
      expect(resolvePhoto('Thandi', index)).toMatchObject({ dataUrl: null, status: 'not_found' });
      expect(resolvePhoto('Thandi N.jpg', index)).toMatchObject({ dataUrl: null, status: 'not_found' });
    });

    it('explains whether photos were chosen at all', () => {
      expect(resolvePhoto('a.jpg', buildPhotoIndex({}))).toMatchObject({ status: 'not_found', message: expect.stringMatching(/no photos were chosen/) });
      expect(resolvePhoto('a.jpg', index)).toMatchObject({ status: 'not_found', message: expect.stringMatching(/not among the chosen/) });
    });

    it('re-validates a matched file rather than trusting the caller', () => {
      const bad = buildPhotoIndex({ 'x.jpg': 'data:image/jpeg;base64,AAAA' });
      expect(resolvePhoto('x.jpg', bad)).toMatchObject({ dataUrl: null, status: 'invalid' });
    });

    it('caps how many photo files one import may carry', () => {
      const many = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`p${i}.png`, png]));
      expect(() => buildPhotoIndex(many)).toThrow(/Too many photo files/);
    });
  });

  describe('links', () => {
    it('are never fetched and leave the photo blank', () => {
      expect(resolvePhoto('https://drive.google.com/open?id=1abc')).toMatchObject({ dataUrl: null, status: 'link' });
      expect(resolvePhoto('HTTP://example.com/a.jpg')).toMatchObject({ dataUrl: null, status: 'link' });
    });
  });

  describe('embedded images', () => {
    it('accepts real PNG, JPEG and WebP data', () => {
      expect(resolvePhoto(png)).toMatchObject({ dataUrl: png, status: 'embedded' });
      expect(resolvePhoto(jpeg)).toMatchObject({ dataUrl: jpeg, status: 'embedded' });
      expect(resolvePhoto(webp)).toMatchObject({ dataUrl: webp, status: 'embedded' });
    });

    it('normalises image/jpg and tolerates line breaks in the base64', () => {
      const wrapped = `data:image/jpg;base64,${jpegBytes.toString('base64').replace(/(.{20})/g, '$1\n')}`;
      expect(inspectImageDataUrl(wrapped)).toEqual({ dataUrl: jpeg });
    });

    it('rejects SVG, mismatched content, non-images and oversized files', () => {
      expect(inspectImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toHaveProperty('error');
      // PNG bytes labelled as JPEG
      expect(inspectImageDataUrl(`data:image/jpeg;base64,${PNG_1X1}`)).toEqual({ error: 'is not a valid image file' });
      expect(inspectImageDataUrl('data:text/plain;base64,aGk=')).toHaveProperty('error');
      expect(inspectImageDataUrl('not a data url')).toEqual({ error: 'is not an image' });

      const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_PHOTO_BYTES + 1, 1)]);
      expect(inspectImageDataUrl(`data:image/jpeg;base64,${huge.toString('base64')}`).error).toMatch(/too large/);
    });
  });
});
