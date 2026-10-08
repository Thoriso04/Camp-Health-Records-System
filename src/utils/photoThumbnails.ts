/**
 * Prepares photo files chosen in the registration import for storage.
 *
 * Phone photos are several megabytes. CHRS keeps a camper's photo inside their
 * encrypted record (and the audit trail copies that record), so each photo is
 * shrunk here to a small JPEG thumbnail, plenty to recognise a child at the
 * medical tent, before it is sent to the main process. Nothing leaves the laptop.
 */

const MAX_EDGE_PX = 320;
const JPEG_QUALITY = 0.82;
const IMAGE_NAME = /\.(jpe?g|png|webp|gif|bmp)$/i;

export interface PreparedPhotos {
  /** file name -> thumbnail data URL; what the main process matches photo cells against */
  files: Record<string, string>;
  /** image files the browser could not decode (for example HEIC straight from an iPhone) */
  unreadable: string[];
  /** names that occur more than once among the chosen files; skipped, because guessing would risk the wrong child's photo */
  duplicates: string[];
}

/** Shrinks any picture the browser can decode to a small upright JPEG data URL. */
export async function thumbnailFromBlob(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file); // honours the photo's EXIF rotation
  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    context.fillStyle = '#ffffff'; // JPEG has no transparency; avoid black backgrounds from PNGs
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

export async function prepareThumbnails(
  chosen: File[],
  onProgress?: (done: number, total: number) => void
): Promise<PreparedPhotos> {
  // Folders contain other things (Thumbs.db, notes); ignore anything that isn't a picture.
  const images = chosen.filter((file) => file.type.startsWith('image/') || IMAGE_NAME.test(file.name) || /\.hei[cf]$/i.test(file.name));

  const byName = new Map<string, File[]>();
  for (const file of images) {
    const key = file.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), file]);
  }

  const result: PreparedPhotos = { files: {}, unreadable: [], duplicates: [] };
  const unique = [...byName.values()].filter((group) => {
    if (group.length === 1) return true;
    result.duplicates.push(group[0].name);
    return false;
  });

  let done = 0;
  for (const [file] of unique) {
    try {
      result.files[file.name] = await thumbnailFromBlob(file);
    } catch {
      result.unreadable.push(file.name);
    }
    done += 1;
    onProgress?.(done, unique.length);
  }
  return result;
}
