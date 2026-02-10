import { create } from 'zustand';
import type { CheckinStep, Guest, Room, Reservation, PassportScanResult, PaymentResult, RoomUpgrade } from '../types';

interface CheckinState {
  // Current step
  currentStep: CheckinStep;
  
  // Guest data
  guest: Guest | null;
  passportScan: PassportScanResult | null;
  
  // Reservation data
  reservation: Reservation | null;
  confirmationCode: string;
  
  // Room selection
  selectedRoom: Room | null;
  availableUpgrades: RoomUpgrade[];
  selectedUpgrade: RoomUpgrade | null;
  
  // Payment
  paymentResult: PaymentResult | null;
  
  // AI-driven flow: pending message to send to AI on behalf of the user
  pendingMessage: string | null;
  
  // Session
  sessionId: string;
  sessionStartTime: number | null;
  
  // Actions
  setStep: (step: CheckinStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  setGuest: (guest: Guest) => void;
  setPassportScan: (result: PassportScanResult) => void;
  setReservation: (reservation: Reservation) => void;
  setConfirmationCode: (code: string) => void;
  setSelectedRoom: (room: Room) => void;
  setAvailableUpgrades: (upgrades: RoomUpgrade[]) => void;
  setSelectedUpgrade: (upgrade: RoomUpgrade | null) => void;
  setPaymentResult: (result: PaymentResult) => void;
  setPendingMessage: (msg: string | null) => void;
  resetSession: () => void;
}

const STEP_ORDER: CheckinStep[] = [
  'welcome',
  'identify',
  'passport-scan',
  'reservation-found',
  'room-selection',
  'upgrade-offer',
  'payment',
  'key-card',
  'farewell',
];

const generateSessionId = () => `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const useCheckinStore = create<CheckinState>((set, get) => ({
  currentStep: 'welcome',
  guest: null,
  passportScan: null,
  reservation: null,
  confirmationCode: '',
  selectedRoom: null,
  availableUpgrades: [],
  selectedUpgrade: null,
  paymentResult: null,
  pendingMessage: null,
  sessionId: generateSessionId(),
  sessionStartTime: null,

  setStep: (step) => set({ currentStep: step }),

  nextStep: () => {
    const { currentStep } = get();
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex < STEP_ORDER.length - 1) {
      set({ currentStep: STEP_ORDER[currentIndex + 1] });
    }
  },

  prevStep: () => {
    const { currentStep } = get();
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex > 0) {
      set({ currentStep: STEP_ORDER[currentIndex - 1] });
    }
  },

  setGuest: (guest) => set({ guest }),
  setPassportScan: (result) => set({ passportScan: result }),
  setReservation: (reservation) => set({ reservation }),
  setConfirmationCode: (code) => set({ confirmationCode: code }),
  setSelectedRoom: (room) => set({ selectedRoom: room }),
  setAvailableUpgrades: (upgrades) => set({ availableUpgrades: upgrades }),
  setSelectedUpgrade: (upgrade) => set({ selectedUpgrade: upgrade }),
  setPaymentResult: (result) => set({ paymentResult: result }),
  setPendingMessage: (msg) => set({ pendingMessage: msg }),

  resetSession: () => set({
    currentStep: 'welcome',
    guest: null,
    passportScan: null,
    reservation: null,
    confirmationCode: '',
    selectedRoom: null,
    availableUpgrades: [],
    selectedUpgrade: null,
    paymentResult: null,
    pendingMessage: null,
    sessionId: generateSessionId(),
    sessionStartTime: null,
  }),
}));
