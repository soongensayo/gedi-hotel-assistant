'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Room } from '@/lib/types';
import { AddRoomModal } from './AddRoomModal';

export function RoomsPanel() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const loadRooms = async () => {
    setLoading(true);
    const { data } = await supabase.from('rooms').select('*').order('room_number');
    if (data) setRooms(data as Room[]);
    setLoading(false);
  };

  useEffect(() => { loadRooms(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this room?')) return;
    await supabase.from('rooms').delete().eq('id', id);
    loadRooms();
  };

  const toggleAvailability = async (id: string, current: boolean) => {
    await supabase.from('rooms').update({ is_available: !current }).eq('id', id);
    loadRooms();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-warm-gray">{rooms.length} rooms</p>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-gold text-white text-sm rounded-lg hover:bg-gold-dark transition-colors"
        >
          + Add Room
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-warm-gray py-8 text-center">Loading...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm-gray-lighter text-left">
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Room</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Type</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Floor</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Price</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Bed</th>
                <th className="py-2 pr-4 text-xs font-medium text-warm-gray">Available</th>
                <th className="py-2 text-xs font-medium text-warm-gray">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.id} className="border-b border-warm-gray-lighter/50 hover:bg-cream-dark/30">
                  <td className="py-2.5 pr-4 font-medium">{room.room_number}</td>
                  <td className="py-2.5 pr-4 capitalize">{room.type}</td>
                  <td className="py-2.5 pr-4">{room.floor}</td>
                  <td className="py-2.5 pr-4">{room.currency} {room.price_per_night}</td>
                  <td className="py-2.5 pr-4 text-warm-gray">{room.bed_type || '—'}</td>
                  <td className="py-2.5 pr-4">
                    <button
                      onClick={() => toggleAvailability(room.id, room.is_available)}
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        room.is_available ? 'bg-success/10 text-success' : 'bg-warm-gray-lighter text-warm-gray'
                      }`}
                    >
                      {room.is_available ? 'Yes' : 'No'}
                    </button>
                  </td>
                  <td className="py-2.5">
                    <button onClick={() => handleDelete(room.id)} className="text-error/60 hover:text-error text-xs">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <AddRoomModal onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); loadRooms(); }} />}
    </div>
  );
}
