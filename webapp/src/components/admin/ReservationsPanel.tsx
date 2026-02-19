'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Reservation } from '@/lib/types';
import { formatDate } from '@/lib/utils';

const STATUS_OPTIONS = ['confirmed', 'checked-in', 'checked-out', 'cancelled'] as const;

const statusStyles: Record<string, string> = {
  confirmed: 'bg-gold/10 text-gold',
  'checked-in': 'bg-success/10 text-success',
  'checked-out': 'bg-warm-gray-lighter text-warm-gray',
  cancelled: 'bg-error/10 text-error',
};

export function ReservationsPanel() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  const loadReservations = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('reservations')
      .select('*, guest:guests(first_name, last_name), room:rooms(room_number, type)')
      .order('created_at', { ascending: false });
    if (data) setReservations(data as unknown as Reservation[]);
    setLoading(false);
  };

  useEffect(() => { loadReservations(); }, []);

  const handleStatusChange = async (id: string, status: string) => {
    await supabase.from('reservations').update({ status }).eq('id', id);
    loadReservations();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this reservation?')) return;
    await supabase.from('reservations').delete().eq('id', id);
    loadReservations();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-warm-gray">{reservations.length} reservations</p>

      {loading ? (
        <p className="text-sm text-warm-gray py-8 text-center">Loading...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm-gray-lighter text-left">
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Code</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Guest</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Room</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Dates</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Amount</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Status</th>
                <th className="py-2 text-xs font-medium text-warm-gray">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((res) => {
                const guest = res.guest as unknown as { first_name: string; last_name: string } | null;
                const room = res.room as unknown as { room_number: string; type: string } | null;
                return (
                  <tr key={res.id} className="border-b border-warm-gray-lighter/50 hover:bg-cream-dark/30">
                    <td className="py-2.5 pr-4 font-mono text-xs font-medium">{res.confirmation_code}</td>
                    <td className="py-2.5 pr-4">
                      {guest ? `${guest.first_name} ${guest.last_name}` : '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-warm-gray">
                      {room ? `${room.room_number} (${room.type})` : '—'}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-warm-gray">
                      {formatDate(res.check_in_date)} — {formatDate(res.check_out_date)}
                    </td>
                    <td className="py-2.5 pr-4">{res.currency} {res.total_amount.toLocaleString()}</td>
                    <td className="py-2.5 pr-4">
                      <select
                        value={res.status}
                        onChange={(e) => handleStatusChange(res.id, e.target.value)}
                        className={`text-xs px-2 py-1 rounded-full border-0 cursor-pointer ${statusStyles[res.status] || ''}`}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5">
                      <button onClick={() => handleDelete(res.id)} className="text-error/60 hover:text-error text-xs">
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
