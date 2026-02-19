'use client';

import { useState } from 'react';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { RoomsPanel } from '@/components/admin/RoomsPanel';
import { GuestsPanel } from '@/components/admin/GuestsPanel';
import { ReservationsPanel } from '@/components/admin/ReservationsPanel';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('rooms');

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-light tracking-tight text-charcoal">Admin Dashboard</h1>
        <p className="text-warm-gray text-sm mt-1">Manage rooms, guests, and reservations</p>
      </div>

      <AdminTabs activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="bg-white border border-warm-gray-lighter rounded-xl p-6">
        {activeTab === 'rooms' && <RoomsPanel />}
        {activeTab === 'guests' && <GuestsPanel />}
        {activeTab === 'reservations' && <ReservationsPanel />}
      </div>
    </div>
  );
}
