// electron/services/registrationPhotos.js
//
// Turns the "Photo" cell of a registration row into the image CHRS stores
// (a data URL inside the patient's medical_notes JSON, exactly what the
// in-app "Add photo" button already produces), or into null.
//
// THE RULE: no photo -> blank. A blank cell, a file name that matches no
// chosen photo, a Google Drive link, a corrupt or oversized image: every one
// of these yields `dataUrl: null`. A child is never given somebody else's
// photo, a placeholder, or a broken image. The `status` and `message` only
// exist so the import preview can tell staff *why* a photo is blank.
//
// What a photo cell may contain:
//   - nothing                          -> no photo
//   - a file name ("thandi.jpg")       -> matched, case-insensitively, against
//                                          the photo files chosen in the import
//                                          dialog. Without an extension
//                                          ("thandi") it matches only if exactly
//                                          one chosen file has that name.
//   - a data:image/...;base64,... URL  -> used if it is a genuine PNG/JPEG/WebP
//   - a Google Drive link              -> what a Google Form "file upload" question
//                                          writes into the sheet
//                                          (https://drive.google.com/open?id=...).
//                                          This module never downloads anything.
//                                          The photo is matched by its Drive file ID
//                                          against photos the app has already
//                                          downloaded and shrunk (see
//                                          registration:fetch-drive-photos). Until
//                                          then it resolves to blank ("drive_pending").
//   - any other web link               -> NOT fetched. Blank, with a warning.
//
// Matching is by explicit file name only. Guessing from the child's name
// would be wrong for siblings or two children with the same name, and a
// wrong face on a medical record is worse than none.

// Photos are shrunk to a small thumbnail by the import dialog before they get
// here. The cap is a backstop so an unshrunk multi-megabyte photo can't bloat
// the encrypted database or the audit log (which copies medical_notes).
const MAX_PHOTO_BYTES = 200 * 1024;
const MAX_PHOTO_FILES = 2000;

const IMAGE_TYPES = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
};

// Photos fetched from Google Drive are handed in under the key "drive:<fileId>".
// A colon cannot appear in a Windows file name, so this can never collide with
// a real file chosen from disk.
const DRIVE_KEY_PREFIX = 'drive:';
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

const DATA_URL = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i;
const HAS_IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i;

/**
 * Validates a data URL. SVG and anything else that isn't a raster image whose
 * bytes really are a JPEG/PNG/WebP is refused.
 * @returns {{ dataUrl: string } | { error: string }}
 */
function inspectImageDataUrl(value) {
  const match = DATA_URL.exec(String(value ?? '').trim());
  if (!match) return { error: 'is not an image' };

  const type = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const matchesSignature = IMAGE_TYPES[type];
  if (!matchesSignature) return { error: 'is not a JPEG, PNG or WebP image' };

  const base64 = match[2].replace(/\s+/g, '');
  const bytes = Buffer.from(base64, 'base64');
  if (!matchesSignature(bytes)) return { error: 'is not a valid image file' };
  if (bytes.length > MAX_PHOTO_BYTES) {
    return { error: `is too large (${Math.round(bytes.length / 1024)} KB; the limit is ${MAX_PHOTO_BYTES / 1024} KB)` };
  }
  return { dataUrl: `data:${type};base64,${base64}` };
}

// "C:\Users\me\photos\Thandi.JPG" and "photos/Thandi.JPG" both mean "thandi.jpg".
function fileKey(name) {
  return String(name ?? '').normalize('NFC').split(/[\\/]/).pop().trim().toLowerCase();
}

/**
 * File IDs in a photo cell. A Form upload question stores
 * "https://drive.google.com/open?id=<id>", and several uploads are joined
 * with commas. Also understands the /file/d/<id>/view and uc?id=<id> shapes
 * in case someone pastes a link by hand. Only drive.google.com links count.
 * @returns {string[]} IDs in the order they appear, without repeats
 */
function extractDriveFileIds(cell) {
  const ids = [];
  for (const part of String(cell ?? '').split(/[\s,;]+/)) {
    let url;
    try { url = new URL(part); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || url.hostname !== 'drive.google.com') continue;
    const id = url.searchParams.get('id') ?? /\/(?:file\/d|folders)\/([^/]+)/.exec(url.pathname)?.[1] ?? '';
    if (DRIVE_ID.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function stripExtension(key) {
  return key.replace(/\.[a-z0-9]{1,5}$/i, '');
}

/**
 * Builds the lookup used to match file names. Safe to build once and reuse
 * for every row.
 * @param {Record<string, string>} photoFiles  file name -> data URL
 */
function buildPhotoIndex(photoFiles) {
  const entries = photoFiles && typeof photoFiles === 'object' ? Object.entries(photoFiles) : [];
  if (entries.length > MAX_PHOTO_FILES) {
    throw new Error(`Too many photo files (${entries.length}). Choose at most ${MAX_PHOTO_FILES} at a time.`);
  }

  const byName = new Map();
  const byNameWithoutExtension = new Map();
  const byDriveId = new Map();
  for (const [name, dataUrl] of entries) {
    if (String(name).startsWith(DRIVE_KEY_PREFIX)) {
      const id = String(name).slice(DRIVE_KEY_PREFIX.length);
      if (DRIVE_ID.test(id)) byDriveId.set(id, dataUrl);
      continue;
    }
    const key = fileKey(name);
    if (!key) continue;
    byName.set(key, { name, dataUrl });
    const bare = stripExtension(key);
    byNameWithoutExtension.set(bare, [...(byNameWithoutExtension.get(bare) ?? []), { name, dataUrl }]);
  }
  return { byName, byNameWithoutExtension, byDriveId, count: byName.size };
}

/**
 * @param {unknown} reference  the raw cell text
 * @param {ReturnType<typeof buildPhotoIndex>} index
 * @returns {{ dataUrl: string | null,
 *             status: 'none'|'embedded'|'matched'|'drive'|'drive_pending'|'not_found'|'ambiguous'|'link'|'invalid',
 *             message: string,
 *             driveFileId?: string }}
 * `driveFileId` is set whenever the cell is a Drive link, so the caller knows
 * what to download when status is 'drive_pending'.
 */
function resolvePhoto(reference, index = buildPhotoIndex({})) {
  const text = String(reference ?? '').trim();
  if (!text) return { dataUrl: null, status: 'none', message: 'No photo' };

  if (/^data:/i.test(text)) {
    const checked = inspectImageDataUrl(text);
    return checked.dataUrl
      ? { dataUrl: checked.dataUrl, status: 'embedded', message: 'Photo included in the file' }
      : { dataUrl: null, status: 'invalid', message: `Photo ${checked.error}; imported without a photo` };
  }

  if (/^https?:\/\//i.test(text)) {
    const driveIds = extractDriveFileIds(text);
    if (driveIds.length > 0) {
      const [driveFileId] = driveIds;
      const extra = driveIds.length > 1 ? ` (${driveIds.length} files were uploaded; the first is used)` : '';
      const downloaded = index.byDriveId.get(driveFileId);
      if (!downloaded) {
        return {
          dataUrl: null,
          status: 'drive_pending',
          driveFileId,
          message: `Photo is on Google Drive and has not been downloaded yet${extra}; it will be imported without a photo until it is`,
        };
      }
      const checked = inspectImageDataUrl(downloaded);
      return checked.dataUrl
        ? { dataUrl: checked.dataUrl, status: 'drive', driveFileId, message: `Photo from Google Drive${extra}` }
        : { dataUrl: null, status: 'invalid', driveFileId, message: `Photo from Google Drive ${checked.error}; imported without a photo` };
    }
    return {
      dataUrl: null,
      status: 'link',
      message: 'Photo is a web link that is not a Google Drive upload, which CHRS does not download; imported without a photo. Save the picture to a folder and put its file name in this column instead',
    };
  }

  const key = fileKey(text);
  let found = index.byName.get(key);
  if (!found && !HAS_IMAGE_EXTENSION.test(key)) {
    const candidates = index.byNameWithoutExtension.get(stripExtension(key)) ?? [];
    if (candidates.length > 1) {
      return { dataUrl: null, status: 'ambiguous', message: `More than one chosen photo is named "${text}"; imported without a photo` };
    }
    found = candidates[0];
  }

  if (!found) {
    return {
      dataUrl: null,
      status: 'not_found',
      message: index.count === 0
        ? `Photo "${text}" was named but no photos were chosen; imported without a photo`
        : `Photo "${text}" was not among the chosen photos; imported without a photo`,
    };
  }

  const checked = inspectImageDataUrl(found.dataUrl);
  return checked.dataUrl
    ? { dataUrl: checked.dataUrl, status: 'matched', message: `Photo "${found.name}"` }
    : { dataUrl: null, status: 'invalid', message: `Photo "${found.name}" ${checked.error}; imported without a photo` };
}

module.exports = {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_FILES,
  DRIVE_KEY_PREFIX,
  inspectImageDataUrl,
  extractDriveFileIds,
  buildPhotoIndex,
  resolvePhoto,
};
