import { apiService } from '../services/api';
import { thumbnailFromBlob } from './photoThumbnails';

/**
 * Downloads the photos that parents uploaded through the Google Form (they
 * arrive in the sheet as Google Drive links) and shrinks each to a small
 * thumbnail, ready to be passed to the import as `photoFiles`.
 *
 * The main process does the downloading (it holds the Google key; the screen
 * never sees it). Photos are fetched a few at a time and shrunk immediately,
 * so full-size phone photos are never all held in memory at once.
 *
 * Entries are keyed "drive:<fileId>", which is how the importer matches them
 * to the links in the sheet.
 */

const BATCH_SIZE = 10;

export interface DrivePhotoResult {
  /** "drive:<fileId>" -> thumbnail data URL */
  files: Record<string, string>;
  /** file id -> why that one photo could not be used */
  failed: Record<string, string>;
  /** set when nothing more could be downloaded (offline, not set up, Drive API off...) */
  fatal?: { code?: string; message: string };
}

interface FetchResponse {
  success: boolean;
  error?: string;
  code?: string;
  photos?: Record<string, Uint8Array>;
  failures?: Record<string, { code: string; message: string }>;
}

export async function downloadDrivePhotoThumbnails(
  fileIds: string[],
  onProgress?: (done: number, total: number) => void
): Promise<DrivePhotoResult> {
  const result: DrivePhotoResult = { files: {}, failed: {} };
  const ids = [...new Set(fileIds)];
  let done = 0;

  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const batch = ids.slice(start, start + BATCH_SIZE);
    let response: FetchResponse;
    try {
      response = await apiService.request<FetchResponse>('registration:fetch-drive-photos', { fileIds: batch });
    } catch (error) {
      result.fatal = { message: error instanceof Error ? error.message : 'The photos could not be downloaded.' };
      return result;
    }
    if (!response?.success) {
      result.fatal = { code: response?.code, message: response?.error || 'The photos could not be downloaded.' };
      return result;
    }

    for (const id of batch) {
      const bytes = response.photos?.[id];
      if (bytes) {
        try {
          // Copy into a plain ArrayBuffer-backed array so Blob accepts it.
          result.files[`drive:${id}`] = await thumbnailFromBlob(new Blob([new Uint8Array(bytes)]));
        } catch {
          result.failed[id] = 'The picture could not be opened (iPhone HEIC photos are not supported).';
        }
      } else {
        result.failed[id] = response.failures?.[id]?.message || 'The photo could not be downloaded.';
      }
      done += 1;
      onProgress?.(done, ids.length);
    }
  }
  return result;
}
