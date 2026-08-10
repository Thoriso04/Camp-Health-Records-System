import { AlertTriangle, ShieldAlert } from 'lucide-react';

export interface AllergyAlertProps {
  allergies: string[];
  diagnosis?: string;
  medicalNotes?: string;
}

export const AllergyAlertBanner = ({
  allergies = [],
  diagnosis,
  medicalNotes,
}: AllergyAlertProps) => {
  const hasAllergies = allergies && allergies.length > 0;
  const hasCriticalInfo = hasAllergies || diagnosis || medicalNotes;

  if (!hasCriticalInfo) {
    return (
      <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Clinical Alerts:</span>
          <span className="text-sm">No known medical alerts or allergies recorded for this patient.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border-2 border-red-600 bg-red-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-6 w-6 flex-shrink-0 text-red-600 mt-0.5 animate-pulse" />
        <div className="w-full">
          <div className="flex items-center justify-between border-b border-red-200 pb-2 mb-2">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-red-900 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-700" />
              CRITICAL CLINICAL ALERTS
            </h3>
            <span className="rounded bg-red-200 px-2 py-0.5 text-xs font-bold text-red-800 uppercase">
              High Visibility
            </span>
          </div>

          {diagnosis && (
            <div className="mb-2 text-sm text-red-950">
              <span className="font-bold">Primary Diagnosis: </span>
              <span className="font-semibold text-red-900">{diagnosis}</span>
            </div>
          )}

          <div className="text-sm text-red-950">
            <span className="font-bold">Known Allergies: </span>
            {hasAllergies ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {allergies.map((allergy, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center rounded-md bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white shadow-sm"
                  >
                    {allergy}
                  </span>
                ))}
              </div>
            ) : (
              <span className="italic text-red-800">None reported</span>
            )}
          </div>

          {medicalNotes && (
            <div className="mt-2 text-xs text-red-800 border-t border-red-200 pt-2">
              <span className="font-bold">Clinical Precaution Note: </span>
              {medicalNotes}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AllergyAlertBanner;
