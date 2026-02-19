'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function AddRoomModal({ onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    room_number: '',
    type: 'standard',
    floor: '',
    price_per_night: '',
    currency: 'SGD',
    max_occupancy: '2',
    bed_type: 'King',
    amenities: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!form.room_number || !form.floor || !form.price_per_night) {
      setError('Room number, floor, and price are required');
      return;
    }
    setSaving(true);
    setError('');

    const { error: err } = await supabase.from('rooms').insert({
      room_number: form.room_number.trim(),
      type: form.type,
      floor: parseInt(form.floor),
      price_per_night: parseFloat(form.price_per_night),
      currency: form.currency,
      max_occupancy: parseInt(form.max_occupancy),
      bed_type: form.bed_type || null,
      amenities: form.amenities.split(',').map((a) => a.trim()).filter(Boolean),
      description: form.description.trim() || null,
      is_available: true,
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
        <h3 className="text-lg font-medium text-charcoal">Add Room</h3>

        {error && <p className="text-error text-sm">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <Input label="Room Number *" value={form.room_number} onChange={(v) => setForm({ ...form, room_number: v })} placeholder="1204" />
          <Select label="Type" value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={['standard', 'deluxe', 'suite', 'penthouse']} />
          <Input label="Floor *" value={form.floor} onChange={(v) => setForm({ ...form, floor: v })} type="number" />
          <Input label="Price/Night *" value={form.price_per_night} onChange={(v) => setForm({ ...form, price_per_night: v })} type="number" />
          <Input label="Currency" value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} />
          <Input label="Max Occupancy" value={form.max_occupancy} onChange={(v) => setForm({ ...form, max_occupancy: v })} type="number" />
          <Input label="Bed Type" value={form.bed_type} onChange={(v) => setForm({ ...form, bed_type: v })} placeholder="King" />
        </div>
        <Input label="Amenities (comma-separated)" value={form.amenities} onChange={(v) => setForm({ ...form, amenities: v })} placeholder="City View, Mini Bar, Rain Shower" />
        <Input label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="Elegant room with city views." />

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-warm-gray hover:text-charcoal">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-gold text-white text-sm font-medium rounded-lg hover:bg-gold-dark disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Add Room'}
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

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-charcoal-light">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 text-sm border border-warm-gray-light rounded-lg focus:outline-none focus:border-gold">
        {options.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
      </select>
    </label>
  );
}
