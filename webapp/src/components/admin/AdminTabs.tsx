'use client';

interface Props {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TABS = [
  { id: 'rooms', label: 'Rooms' },
  { id: 'guests', label: 'Guests' },
  { id: 'reservations', label: 'Reservations' },
];

export function AdminTabs({ activeTab, onTabChange }: Props) {
  return (
    <div className="flex gap-1 bg-warm-gray-lighter/50 p-1 rounded-lg">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`px-5 py-2 text-sm rounded-md transition-colors ${
            activeTab === tab.id
              ? 'bg-white text-charcoal font-medium shadow-sm'
              : 'text-warm-gray hover:text-charcoal'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
