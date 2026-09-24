import { useRef, useState, useEffect } from 'react';
import { Eraser } from 'lucide-react';

/**
 * SignaturePad
 *
 * Minimal canvas-based signature capture — no external dependency.
 * Exports the drawn signature as a base64 PNG data URL via onChange,
 * so it can be stored alongside the rest of the indemnity form payload.
 * Not a legal-grade e-signature solution (no timestamp/identity
 * binding beyond what the rest of the form captures) — worth
 * confirming with the team whether this level of signature capture
 * satisfies the paper form's "Signature" requirement, or whether a
 * proper e-signature provider is needed for POPIA/legal purposes.
 */

interface SignaturePadProps {
  label: string;
  onChange: (dataUrl: string | null) => void;
  error?: string;
}

export default function SignaturePad({ label, onChange, error }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1C1B1A';
  }, []);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const point = 'touches' in e ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  };

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stop = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    onChange(canvasRef.current?.toDataURL('image/png') ?? null);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    onChange(null);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-sm font-medium text-ink">
          {label}<span className="ml-0.5 text-alert-500">*</span>
        </label>
        {hasSignature && (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-alert-600">
            <Eraser className="h-3 w-3" aria-hidden="true" />
            Clear
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        width={400}
        height={120}
        className={`w-full touch-none rounded border bg-white ${error ? 'border-alert-500' : 'border-slate-300'}`}
        onMouseDown={start}
        onMouseMove={draw}
        onMouseUp={stop}
        onMouseLeave={stop}
        onTouchStart={start}
        onTouchMove={draw}
        onTouchEnd={stop}
      />
      <p className="mt-1 text-xs text-slate-500">Sign with mouse or touch above.</p>
      {error && <p className="mt-1 text-xs font-medium text-alert-600">{error}</p>}
    </div>
  );
}