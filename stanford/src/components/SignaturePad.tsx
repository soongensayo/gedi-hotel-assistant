import { useEffect, useRef } from 'react';
import SignaturePadLib from 'signature_pad';

type Props = {
  onSubmit: (dataUrl: string) => void;
};

export function SignatureCapture({ onSubmit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pad = new SignaturePadLib(canvas, {
      backgroundColor: 'rgb(12, 10, 9)',
      penColor: 'rgb(212, 176, 122)',
    });
    padRef.current = pad;

    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width = w * ratio;
      canvas.height = h * ratio;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(ratio, ratio);
      pad.clear();
    };
    resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      pad.off();
      padRef.current = null;
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-[var(--color-hotel-border)]">
        <canvas ref={canvasRef} className="h-40 w-full touch-none" />
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/80"
          onClick={() => padRef.current?.clear()}
        >
          Clear
        </button>
        <button
          type="button"
          className="rounded-lg bg-[var(--color-hotel-accent)] px-4 py-2 text-sm font-medium text-black"
          onClick={() => {
            const pad = padRef.current;
            if (!pad || pad.isEmpty()) return;
            onSubmit(pad.toDataURL('image/png'));
          }}
        >
          Submit signature
        </button>
      </div>
    </div>
  );
}
