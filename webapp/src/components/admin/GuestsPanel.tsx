'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Guest } from '@/lib/types';
import { AddGuestModal } from './AddGuestModal';

export function GuestsPanel() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const loadGuests = async () => {
    setLoading(true);
    const { data } = await supabase.from('guests').select('*').order('created_at', { ascending: false });
    if (data) setGuests(data as Guest[]);
    setLoading(false);
  };

  useEffect(() => { loadGuests(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this guest? This will fail if they have reservations.')) return;
    await supabase.from('guests').delete().eq('id', id);
    loadGuests();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-warm-gray">{guests.length} guests</p>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-gold text-white text-sm rounded-lg hover:bg-gold-dark transition-colors"
        >
          + Add Guest
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-warm-gray py-8 text-center">Loading...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm-gray-lighter text-left">
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Name</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Email</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Phone</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Passport</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Nationality</th>
                <th className="py-2 text-xs font-medium text-warm-gray">Actions</th>
              </tr>
            </thead>
            <tbody>
              {guests.map((guest) => (
                <tr key={guest.id} className="border-b border-warm-gray-lighter/50 hover:bg-cream-dark/30">
                  <td className="py-2.5 pr-4 font-medium">{guest.first_name} {guest.last_name}</td>
                  <td className="py-2.5 pr-4 text-warm-gray">{guest.email || '—'}</td>
                  <td className="py-2.5 pr-4 text-warm-gray">{guest.phone || '—'}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs">{guest.passport_number || '—'}</td>
                  <td className="py-2.5 pr-4 text-warm-gray">{guest.nationality || '—'}</td>
                  <td className="py-2.5">
                    <button onClick={() => handleDelete(guest.id)} className="text-error/60 hover:text-error text-xs">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <AddGuestModal onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); loadGuests(); }} />}
    </div>
  );
}
