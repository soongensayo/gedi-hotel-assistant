import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const config = {
  // Server
  port: parseInt(process.env.BACKEND_PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  // Gemini
  geminiApiKey: process.env.GEMINI_API_KEY || '',

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // Avatar
  simliApiKey: process.env.SIMLI_API_KEY || '',
  simliFaceId: process.env.SIMLI_FACE_ID || '',
  didApiKey: process.env.DID_API_KEY || '',
  avatarProvider: (process.env.AVATAR_PROVIDER || 'simli') as 'simli' | 'did',

  // AI
  aiProvider: (process.env.AI_PROVIDER || 'openai') as 'openai' | 'gemini',

  // TTS
  ttsVoice: process.env.TTS_VOICE || 'nova',

  // Hardware
  hardwareMode: (process.env.HARDWARE_MODE || 'mock') as 'mock' | 'jetson',

  // Hotel
  hotelName: process.env.HOTEL_NAME || 'The Grand Azure Hotel',
};

/** Validate that critical API keys are set */
export function validateConfig(): string[] {
  const warnings: string[] = [];

  if (!config.openaiApiKey) {
    warnings.push('OPENAI_API_KEY is not set. AI chat, TTS, and STT will not work.');
  }
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    warnings.push('Supabase credentials not set. Using mock hotel data from memory.');
  }
  if (!config.simliApiKey && !config.didApiKey) {
    warnings.push('No avatar API key set. Avatar features will be disabled.');
  }

  return warnings;
}
