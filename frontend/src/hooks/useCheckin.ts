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

/** Mock passport scan delay — simulates hardware scanning (10 seconds) */
const MOCK_SCAN_DELAY_MS = 10_000;

export function useCheckin() {
  const store = useCheckinStore();
  const addMessage = useConversationStore((s) => s.addMessage);

  const handlePassportScan = useCallback(async () => {
    try {
      addMessage({
        role: 'assistant',
        content: 'Please place your passport on the scanner. I\'ll read it automatically.',
      });

      // In mock mode, wait ~10 seconds then auto-approve
      await new Promise((resolve) => setTimeout(resolve, MOCK_SCAN_DELAY_MS));

      const result = await scanPassport();
      store.setPassportScan(result);

      if (result.success && result.data) {
        addMessage({
          role: 'assistant',
          content: `Thank you, ${result.data.firstName}. I've scanned your passport successfully. Let me look up your reservation.`,
        });

        // Auto-lookup reservation by passport
        const reservation = await lookupReservationByPassport(result.data.passportNumber);
        if (reservation) {
          store.setReservation(reservation);
          if (reservation.guest) {
            store.setGuest(reservation.guest);
          }
          store.setStep('reservation-found');
        } else {
          addMessage({
            role: 'assistant',
            content: `I couldn't find a reservation with your passport details. Could you provide your confirmation code?`,
          });
          store.setStep('identify');
        }
      }
    } catch (err) {
      console.error('Passport scan failed:', err);
      addMessage({
        role: 'assistant',
        content: 'I had trouble scanning your passport. Let me try another way to find your reservation.',
      });
    }
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
      const result = await completeCheckin(store.reservation.id, store.selectedRoom.id);
      // Move to 'farewell' step — the avatar stays visible and the AI
      // continues the conversation naturally (no FarewellScreen).
      store.setStep('farewell');
      addMessage({
        role: 'assistant',
        content: `Your key card for Room ${result.roomNumber} is ready! You're all checked in. Is there anything else I can help you with — maybe some local tips, or questions about the hotel?`,
      });
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
    handleReservationLookup,
    handleRoomSelection,
    handlePayment,
    handleCompleteCheckin,
    goToStep,
  };
}
