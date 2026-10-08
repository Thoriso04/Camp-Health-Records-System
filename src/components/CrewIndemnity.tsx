import { useState } from 'react';
import { apiService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import SignaturePad from './SignaturePad';
import { Section, Field, SavedCard, inputCls } from './FormBits';

/**
 * Camp Crew Member / Indemnity / Media Release (real paper form "Crew
 * Indemnity"). Event name/venue/dates are editable because the paper text
 * is specific to one camp (WESSA Twinstreams, Mtunzini, 29 June - 3 July
 * 2026) and will change each camp. Stored in the staff table, not mixed
 * with camper records. NOTE: whether a drawn signature is legally
 * sufficient for an indemnity is an open question for the client.
 */

const today = () => new Date().toISOString().slice(0, 10);
interface Props { onSaved?: () => void; onCancel?: () => void }

export default function CrewIndemnity({ onSaved, onCancel }: Props) {
  const { user } = useAuth();
  const [fullName, setFullName] = useState('');
  const [idNo, setIdNo] = useState('');
  const [venue, setVenue] = useState('WESSA Twinstreams Environmental Education Centre in Mtunzini in KwaZulu Natal');
  const [campDates, setCampDates] = useState('29 June - 3 July 2026');
  const [noMedia, setNoMedia] = useState(false);
  const [signedAt, setSignedAt] = useState('');
  const [signedOn, setSignedOn] = useState(today());
  const [crewSig, setCrewSig] = useState<string | null>(null);
  const [witnessName, setWitnessName] = useState('');
  const [witnessSig, setWitnessSig] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!fullName.trim()) e.fullName = 'Required.';
    if (!idNo.trim()) e.idNo = 'Required.';
    if (!signedAt.trim()) e.signedAt = 'Required.';
    if (!agree) e.agree = 'The crew member must confirm they have read and accept the indemnity.';
    if (!crewSig) e.crewSig = 'Crew member signature is required.';
    if (!witnessName.trim()) e.witnessName = 'Required.';
    if (!witnessSig) e.witnessSig = 'Witness signature is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const res = await apiService.request<{ success: boolean; message?: string }>('crewindemnity:save', {
        fullName, idNo, venue, campDates, mediaConsent: !noMedia, signedAt, signedOn,
        crewSignature: crewSig, witnessName, witnessSignature: witnessSig, recordedByUserId: user?.userId,
      });
      if (!res?.success) throw new Error(res?.message);
      await apiService.request('audit:log-event', { userId: user?.userId, action: 'CREW_INDEMNITY_SIGNED', actionType: 'CREATE', targetTable: 'staff_forms', details: fullName });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setErrors({ save: err instanceof Error && err.message ? err.message : "Couldn't save. Try again." });
    } finally {
      setSaving(false);
    }
  };

  if (saved) return <SavedCard title="Indemnity signed and saved" note={`Recorded for ${fullName}.`} />;

  return (
    <form onSubmit={save} className="mx-auto max-w-3xl space-y-4 pb-12">
      <div>
        <h1 className="text-lg font-semibold text-ink">Camp Crew Member / Indemnity / Media Release</h1>
        <p className="text-xs text-slate-500">No participant will be accepted to camp if this indemnity form is not signed and returned to the Camp Director.</p>
      </div>

      <Section title="Crew member">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name and surname" required error={errors.fullName}><input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls(errors.fullName)} /></Field>
          <Field label="ID number" required error={errors.idNo}><input value={idNo} onChange={(e) => setIdNo(e.target.value)} className={inputCls(errors.idNo)} /></Field>
          <Field label="Camp venue" className="sm:col-span-2"><input value={venue} onChange={(e) => setVenue(e.target.value)} className={inputCls()} /></Field>
          <Field label="Camp dates"><input value={campDates} onChange={(e) => setCampDates(e.target.value)} className={inputCls()} /></Field>
        </div>
      </Section>

      <Section title="Indemnity">
        <div className="max-h-56 space-y-3 overflow-y-auto rounded border border-slate-200 bg-slate-100 p-4 text-sm text-slate-700">
          <p>I the undersigned, in my capacity as a Camp Crew member/principle caregiver with Camp Footprints held at {venue} from {campDates}, hereby agree that neither myself nor any relative or third person shall have any claim whatsoever and indemnify and hold harmless any individual organiser of the camp, the Camp Director or the organising body, or any sponsor, against any loss or damage or from any claim or action of whatsoever for physical injury or otherwise, suffered by myself or by any other third party, arising from my participation as a Camp Crew member/principle caregiver at the camp, regardless of whether or not same shall have been caused by any omission or the negligence of the aforementioned individual, organising body or sponsor.</p>
          <p><strong>Media Release:</strong> JFF utilize our photos and videos for media releases as well as social media platforms. I understand my name may be used in connection with these materials. By signing this media release, I intend to legally bind myself. Camp Footprints, WESSA Twinstreams Environmental Education Centre and SeriousFun Children&rsquo;s Network shall have the right to use photographs or other images of me in promotional, educational or fundraising materials, the media and on social media platforms, and shall have all rights of copyright in and to such photographs and videos. This consent is voluntary, and I acknowledge that I have legal authority to sign this form.</p>
          <p>We are very aware of our obligations under the POPI Act, and we undertake not to collect your information without a purpose and not to disclose your information to other parties.</p>
          <p>I further consent to participating in all camp activities, excursions, and travel to entertainment venues, informal and group photographic/filming sessions and outings arranged by the organizers of the aforesaid camp entirely at my own risk.</p>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm font-medium text-ink">
          <input type="checkbox" className="mt-1" checked={noMedia} onChange={(e) => setNoMedia(e.target.checked)} />
          I do NOT consent to photos, videos and the media materials above. (I am still welcome at camp; no photos or videos will be taken of me.)
        </label>
        <label className="mt-3 flex items-start gap-2 text-sm font-medium text-ink">
          <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          I have read and accept the indemnity above.
        </label>
        {errors.agree && <p className="mt-1 text-xs font-medium text-alert-600">{errors.agree}</p>}
      </Section>

      <Section title="Signatures">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Signed at (place)" required error={errors.signedAt}><input value={signedAt} onChange={(e) => setSignedAt(e.target.value)} className={inputCls(errors.signedAt)} /></Field>
            <Field label="Date"><input type="date" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} className={inputCls()} /></Field>
          </div>
          <SignaturePad label="Crew member signature" onChange={setCrewSig} error={errors.crewSig} />
          <Field label="Witness name and surname" required error={errors.witnessName}><input value={witnessName} onChange={(e) => setWitnessName(e.target.value)} className={inputCls(errors.witnessName)} /></Field>
          <SignaturePad label="Witness signature" onChange={setWitnessSig} error={errors.witnessSig} />
        </div>
      </Section>

      {errors.save && <p className="text-sm font-medium text-alert-600">{errors.save}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
        <button type="submit" disabled={saving} className="rounded bg-clinical-500 px-5 py-2 text-sm font-semibold text-white hover:bg-clinical-600 disabled:opacity-50">{saving ? 'Saving…' : 'Sign and save'}</button>
      </div>
    </form>
  );
}