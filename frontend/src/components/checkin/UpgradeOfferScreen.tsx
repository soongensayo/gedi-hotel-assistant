import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useCheckinStore } from '../../stores/checkinStore';
import { getRoomUpgrades } from '../../services/api';
import type { RoomUpgrade } from '../../types';

export function UpgradeOfferScreen() {
  const { selectedRoom, selectedUpgrade, setSelectedUpgrade, setPendingMessage } = useCheckinStore();
  const [upgrades, setUpgrades] = useState<RoomUpgrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUpgrades() {
      if (!selectedRoom) return;
      try {
        const available = await getRoomUpgrades(selectedRoom.type);
        setUpgrades(available);
      } catch (err) {
        console.error('Failed to load upgrades:', err);
      } finally {
        setLoading(false);
      }
    }
    loadUpgrades();
  }, [selectedRoom]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-hotel-accent/30 border-t-hotel-accent rounded-full" />
      </div>
    );
  }

  if (upgrades.length === 0) {
    // No upgrades available, skip to payment
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 gap-6">
        <p className="text-hotel-text text-lg">Your room is already our best option!</p>
        <Button onClick={() => setPendingMessage("No upgrades needed, let's proceed to payment.")}>
          Continue to Payment
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full px-8 py-6 gap-6">
      <div className="text-center">
        <h2 className="text-2xl font-light text-hotel-text">Upgrade Your Stay</h2>
        <p className="text-hotel-text-dim text-sm mt-1">
          Exclusive upgrade options available for you
        </p>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4">
        {upgrades.map((upgrade) => (
          <Card
            key={upgrade.id}
            onClick={() => setSelectedUpgrade(
              selectedUpgrade?.id === upgrade.id ? null : upgrade
            )}
            selected={selectedUpgrade?.id === upgrade.id}
            className="flex flex-col gap-3"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="text-hotel-gold text-sm uppercase tracking-wider font-medium">
                  {upgrade.toRoomType}
                </p>
                <p className="text-hotel-text text-lg font-medium">{upgrade.description}</p>
              </div>
              <div className="text-right">
                <p className="text-hotel-gold font-medium">
                  +{upgrade.currency} {upgrade.additionalCostPerNight}
                </p>
                <p className="text-hotel-text-dim text-xs">per night</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {upgrade.highlights.map((highlight, i) => (
                <span
                  key={i}
                  className="text-xs px-3 py-1 rounded-full bg-hotel-gold/10 text-hotel-gold/80 border border-hotel-gold/20"
                >
                  {highlight}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => setPendingMessage("Actually, let me go back and pick a different room.")}>
          Back
        </Button>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={() => { setSelectedUpgrade(null); setPendingMessage("No upgrade for me, let's proceed to payment."); }}>
            No Thanks
          </Button>
          <Button
            variant="gold"
            onClick={() => setPendingMessage(
              selectedUpgrade
                ? `I'd like the ${selectedUpgrade.toRoomType} upgrade please.`
                : "Let's proceed to payment."
            )}
            disabled={!selectedUpgrade}
          >
            {selectedUpgrade ? 'Accept Upgrade' : 'Select an Upgrade'}
          </Button>
        </div>
      </div>
    </div>
  );
}
