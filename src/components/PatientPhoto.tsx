import { useRef, useState } from 'react';
import { Camera, Trash2, UserRound } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { thumbnailFromBlob } from '../utils/photoThumbnails';
import { ProtectedView } from './ProtectedView';

/**
 * A camper's photo on the patient record. Everyone who can see the record sees
 * the photo; only the physician gets the buttons to add, change or remove it.
 * (The main process checks the role again, so hiding the buttons is not the
 * only protection.)
 *
 * A child with no photo shows a plain placeholder, never somebody else's face.
 * The picture is shrunk to a small JPEG here before it is saved, so a
 * multi-megabyte phone photo never reaches the encrypted database.
 */

interface Props {
  patientId: string;
  patientName: string;
  photoDataUrl: string | null;
  onChanged: (photoDataUrl: string | null) => void;
}

interface SetPhotoResponse {
  success: boolean;
  error?: string;
  action?: 'added' | 'replaced' | 'removed' | 'unchanged';
  photoDataUrl?: string | null;
}

export default function PatientPhoto({ patientId, patientName, photoDataUrl, onChanged }: Props) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const save = async (newPhoto: string | null) => {
    const response = await apiService.request<SetPhotoResponse>('patient:set-photo', {
      patientId,
      photoDataUrl: newPhoto,
      userId: user?.userId,
    });
    if (!response?.success) throw new Error(response?.error || 'The photo could not be saved.');
    onChanged(response.photoDataUrl ?? null);
    return response.action;
  };

  const handleChosen = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      let thumbnail: string;
      try {
        thumbnail = await thumbnailFromBlob(file);
      } catch {
        throw new Error('That picture could not be opened. Choose a JPG or PNG file (iPhone HEIC photos are not supported).');
      }
      const action = await save(thumbnail);
      setMessage({ tone: 'ok', text: action === 'replaced' ? 'Photo changed.' : 'Photo saved.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'The photo could not be saved.' });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(`Remove ${patientName}'s photo? The record will have no photo until a new one is added.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await save(null);
      setMessage({ tone: 'ok', text: 'Photo removed.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'The photo could not be removed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      {photoDataUrl ? (
        <img src={photoDataUrl} alt={`Photo of ${patientName}`} className="h-24 w-24 rounded object-cover ring-1 ring-slate-200" />
      ) : (
        <div
          className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded bg-slate-100 text-slate-400 ring-1 ring-slate-200"
          role="img"
          aria-label={`No photo on file for ${patientName}`}
        >
          <UserRound className="h-8 w-8" aria-hidden="true" />
          <span className="text-[10px] font-medium">No photo</span>
        </div>
      )}

      <ProtectedView requiredPermission="MANAGE_PHOTOS">
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-clinical-600 hover:bg-clinical-50 disabled:opacity-50"
            >
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              {busy ? 'Saving…' : photoDataUrl ? 'Change photo' : 'Add photo'}
            </button>
            {photoDataUrl && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-alert-600 hover:bg-alert-50 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Remove
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                handleChosen(e.target.files?.[0]);
                e.target.value = ''; // lets the same file be chosen again
              }}
            />
          </div>
          {message && (
            <p className={`text-xs font-medium ${message.tone === 'ok' ? 'text-confirm-600' : 'text-alert-600'}`} role={message.tone === 'error' ? 'alert' : 'status'}>
              {message.text}
            </p>
          )}
        </div>
      </ProtectedView>
    </div>
  );
}
