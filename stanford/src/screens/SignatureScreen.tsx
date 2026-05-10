import { SignatureCapture } from '../components/SignaturePad';

type Props = {
  onSubmit: (dataUrl: string) => void;
};

export function SignatureScreen({ onSubmit }: Props) {
  return (
    <div className="space-y-4">
      <h3 className="text-center text-xl text-[var(--color-hotel-accent)]">Signature</h3>
      <p className="text-center text-sm text-[var(--color-hotel-text-dim)]">
        Please sign below to acknowledge registration and hotel policies.
      </p>
      <SignatureCapture onSubmit={onSubmit} />
    </div>
  );
}
