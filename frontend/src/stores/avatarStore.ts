import { create } from 'zustand';
import { SimliClient } from 'simli-client';

/**
 * Global avatar state store.
 * The SimliClient instance is shared so that both AvatarDisplay (provides refs)
 * and voice/chat components (send audio) can access the same client.
 */
interface AvatarStore {
  client: SimliClient | null;
  isConnected: boolean;
  isSpeaking: boolean;
  isLoading: boolean;
  error: string | null;

  setClient: (client: SimliClient) => void;
  setConnected: (connected: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useAvatarStore = create<AvatarStore>((set) => ({
  client: null,
  isConnected: false,
  isSpeaking: false,
  isLoading: false,
  error: null,

  setClient: (client) => set({ client }),
  setConnected: (isConnected) => set({ isConnected }),
  setSpeaking: (isSpeaking) => set({ isSpeaking }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  reset: () => set({ client: null, isConnected: false, isSpeaking: false, isLoading: false, error: null }),
}));
