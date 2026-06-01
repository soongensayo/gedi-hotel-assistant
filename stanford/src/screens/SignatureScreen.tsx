import { SignatureCapture } from '../components/SignaturePad';

type Props = {
  onSubmit: (dataUrl: string) => void;
};

export function SignatureScreen({ onSubmit }: Props) {
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <h3 className="text-center text-lg text-[var(--color-hotel-accent)]">Signature</h3>
      <p className="text-center text-xs leading-5 text-[var(--color-hotel-text-dim)]">
        Please sign below to acknowledge registration and hotel policies.
      </p>
      <SignatureCapture onSubmit={onSubmit} />
    </div>
  );
}
