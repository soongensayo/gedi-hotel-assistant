'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function AddGuestModal({ onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    nationality: '',
    passport_number: '',
    date_of_birth: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!form.first_name || !form.last_name) {
      setError('First name and last name are required');
      return;
    }
    setSaving(true);
    setError('');

    const { error: err } = await supabase.from('guests').insert({
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      nationality: form.nationality.trim() || null,
      passport_number: form.passport_number.trim() || null,
      date_of_birth: form.date_of_birth || null,
    });

    if (err) {
      setError(err.message);
      setSaving(false);
    } else {
      onSaved();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-lg mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-medium text-charcoal">Add Guest</h3>

        {error && <p className="text-error text-sm">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <Input label="First Name *" value={form.first_name} onChange={(v) => setForm({ ...form, first_name: v })} placeholder="James" />
          <Input label="Last Name *" value={form.last_name} onChange={(v) => setForm({ ...form, last_name: v })} placeholder="Chen" />
          <Input label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="james@email.com" />
          <Input label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="+65 9123 4567" />
          <Input label="Nationality" value={form.nationality} onChange={(v) => setForm({ ...form, nationality: v })} placeholder="Singapore" />
          <Input label="Passport Number" value={form.passport_number} onChange={(v) => setForm({ ...form, passport_number: v })} placeholder="E1234567A" />
          <Input label="Date of Birth" value={form.date_of_birth} onChange={(v) => setForm({ ...form, date_of_birth: v })} type="date" />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-warm-gray hover:text-charcoal">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-gold text-white text-sm font-medium rounded-lg hover:bg-gold-dark disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Add Guest'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-charcoal-light">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="px-3 py-2 text-sm border border-warm-gray-light rounded-lg focus:outline-none focus:border-gold" />
    </label>
  );
}
