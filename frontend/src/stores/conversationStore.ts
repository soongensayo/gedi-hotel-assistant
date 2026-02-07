import { create } from 'zustand';
import type { ChatMessage } from '../types';

interface ConversationState {
  messages: ChatMessage[];
  isLoading: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  error: string | null;

  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  setLoading: (loading: boolean) => void;
  setListening: (listening: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
}

const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const useConversationStore = create<ConversationState>((set) => ({
  messages: [],
  isLoading: false,
  isListening: false,
  isSpeaking: false,
  error: null,

  addMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { ...message, id: generateId(), timestamp: Date.now() },
      ],
    })),

  setLoading: (isLoading) => set({ isLoading }),
  setListening: (isListening) => set({ isListening }),
  setSpeaking: (isSpeaking) => set({ isSpeaking }),
  setError: (error) => set({ error }),
  clearMessages: () => set({ messages: [] }),
}));
