'use client';

import type { GuestFormData } from '@/lib/types';

interface Props {
  data: GuestFormData;
  onChange: (data: GuestFormData) => void;
  onNext: () => void;
}

export function GuestInfoStep({ data, onChange, onNext }: Props) {
  const update = (field: keyof GuestFormData, value: string) => {
    onChange({ ...data, [field]: value });
  };

  const canProceed = data.first_name.trim() && data.last_name.trim();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-light tracking-tight text-charcoal">Guest Details</h2>
        <p className="text-warm-gray text-sm mt-1">Tell us about yourself</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="First Name *" value={data.first_name} onChange={(v) => update('first_name', v)} placeholder="James" />
        <Field label="Last Name *" value={data.last_name} onChange={(v) => update('last_name', v)} placeholder="Chen" />
        <Field label="Email" value={data.email} onChange={(v) => update('email', v)} placeholder="james@email.com" type="email" />
        <Field label="Phone" value={data.phone} onChange={(v) => update('phone', v)} placeholder="+65 9123 4567" />
        <Field label="Nationality" value={data.nationality} onChange={(v) => update('nationality', v)} placeholder="Singapore" />
        <Field label="Passport Number" value={data.passport_number} onChange={(v) => update('passport_number', v)} placeholder="E1234567A" />
        <Field label="Date of Birth" value={data.date_of_birth} onChange={(v) => update('date_of_birth', v)} type="date" />
      </div>

      <div className="flex justify-end pt-2">
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="px-8 py-3 bg-gold text-white text-sm font-medium rounded-lg hover:bg-gold-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue to Room Selection
        </button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-charcoal-light tracking-wide">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="px-4 py-2.5 text-sm border border-warm-gray-light rounded-lg bg-white focus:outline-none focus:border-gold transition-colors placeholder:text-warm-gray/50"
      />
    </label>
  );
}
