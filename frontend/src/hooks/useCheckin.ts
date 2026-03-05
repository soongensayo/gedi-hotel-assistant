import { useCallback } from 'react';
import { useCheckinStore } from '../stores/checkinStore';
import { useConversationStore } from '../stores/conversationStore';
import {
  lookupReservation,
  lookupReservationByPassport,
  scanPassport,
  processPayment,
  completeCheckin,
  getRoomUpgrades,
} from '../services/api';
import type { CheckinStep } from '../types';

export function useCheckin() {
  const store = useCheckinStore();
  const addMessage = useConversationStore((s) => s.addMessage);

  /** Runs the passport scan and reservation lookup. Returns true on success. */
  const handlePassportScan = useCallback(async (): Promise<boolean> => {
    try {
      const result = await scanPassport();
      store.setPassportScan(result);

      if (result.success && result.data) {
        addMessage({
          role: 'assistant',
          content: `Thank you, ${result.data.firstName}. I've scanned your passport successfully. Let me look up your reservation.`,
        });

        const reservation = await lookupReservationByPassport(result.data.passportNumber);
        if (reservation) {
          store.setReservation(reservation);
          if (reservation.guest) {
            store.setGuest(reservation.guest);
          }
          store.setStep('reservation-found');
          return true;
        }

        addMessage({
          role: 'assistant',
          content: `I couldn't find a reservation with your passport details. Could you provide your confirmation code?`,
        });
        store.setStep('identify');
        return true;
      }

      return false;
    } catch (err) {
      console.error('Passport scan failed:', err);
      return false;
    }
  }, [store, addMessage]);

  const handlePassportBypass = useCallback(() => {
    addMessage({
      role: 'assistant',
      content: 'No problem! Could you please tell me your name or provide your confirmation code? I\'ll look up your reservation that way.',
    });
    store.setStep('identify');
  }, [store, addMessage]);

  const handleReservationLookup = useCallback(async (query: string) => {
    try {
      store.setConfirmationCode(query);
      const reservation = await lookupReservation(query);
      if (reservation) {
        store.setReservation(reservation);
        if (reservation.guest) {
          store.setGuest(reservation.guest);
        }
        store.setStep('reservation-found');
        addMessage({
          role: 'assistant',
          content: `I found your reservation! Welcome, ${reservation.guest?.firstName || 'valued guest'}. Let me show you the details.`,
        });
      } else {
        addMessage({
          role: 'assistant',
          content: `I couldn't find a reservation with that code. Could you double-check and try again?`,
        });
      }
    } catch (err) {
      console.error('Reservation lookup failed:', err);
    }
  }, [store, addMessage]);

  const handleRoomSelection = useCallback(async () => {
    if (!store.selectedRoom) return;

    try {
      const upgrades = await getRoomUpgrades(store.selectedRoom.type);
      if (upgrades.length > 0) {
        store.setAvailableUpgrades(upgrades);
        store.setStep('upgrade-offer');
        addMessage({
          role: 'assistant',
          content: `Great choice! I also have some wonderful upgrade options available for you. Would you like to take a look?`,
        });
      } else {
        store.setStep('payment');
      }
    } catch {
      store.setStep('payment');
    }
  }, [store, addMessage]);

  const handlePayment = useCallback(async () => {
    if (!store.reservation) return;

    try {
      const amount = store.selectedUpgrade
        ? store.reservation.totalAmount + store.selectedUpgrade.additionalCostPerNight
        : store.reservation.totalAmount;

      const result = await processPayment(
        store.reservation.id,
        amount,
        store.reservation.currency
      );

      store.setPaymentResult(result);
    } catch (err) {
      console.error('Payment failed:', err);
    }
  }, [store, addMessage]);

  const handleCompleteCheckin = useCallback(async () => {
    if (!store.reservation || !store.selectedRoom) return;

    try {
      await completeCheckin({
        reservationId: store.reservation.id,
        roomId: store.selectedRoom.id,
        guestEmail: store.guest?.email,
        guestName: store.guest
          ? `${store.guest.firstName} ${store.guest.lastName}`
          : undefined,
        roomNumber: store.selectedRoom.roomNumber,
        roomType: store.selectedRoom.type,
        floor: store.selectedRoom.floor,
        checkInDate: store.reservation.checkInDate,
        checkOutDate: store.reservation.checkOutDate,
        confirmationCode: store.reservation.confirmationCode,
      });
      store.setStep('farewell');
    } catch (err) {
      console.error('Check-in completion failed:', err);
    }
  }, [store, addMessage]);

  const goToStep = useCallback((step: CheckinStep) => {
    store.setStep(step);
  }, [store]);

  return {
    ...store,
    handlePassportScan,
    handlePassportBypass,
    handleReservationLookup,
    handleRoomSelection,
    handlePayment,
    handleCompleteCheckin,
    goToStep,
  };
}
