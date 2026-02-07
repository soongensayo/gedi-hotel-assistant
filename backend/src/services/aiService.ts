import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import { getConciergeSystemPrompt, buildHotelContext } from '../prompts/concierge';

// --- OpenAI Client ---
const openai = config.openaiApiKey
  ? new OpenAI({ apiKey: config.openaiApiKey })
  : null;

// --- Gemini Client ---
const genAI = config.geminiApiKey
  ? new GoogleGenerativeAI(config.geminiApiKey)
  : null;

// In-memory conversation history per session
const sessionHistory: Map<string, Array<{ role: 'user' | 'assistant' | 'system'; content: string }>> = new Map();

/**
 * Send a message to the AI and get a response.
 * Uses OpenAI by default, falls back to Gemini.
 */
export async function chat(
  message: string,
  sessionId: string,
  context?: Record<string, unknown>
): Promise<string> {
  // Get or create session history
  if (!sessionHistory.has(sessionId)) {
    sessionHistory.set(sessionId, []);
  }
  const history = sessionHistory.get(sessionId)!;

  // Build hotel context
  const hotelContext = context ? buildHotelContext(context as {
    hotelInfo?: Record<string, unknown>;
    reservation?: Record<string, unknown>;
    currentStep?: string;
  }) : '';

  // Add user message to history
  history.push({ role: 'user', content: message });

  // Keep history manageable (last 20 messages)
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }

  try {
    if (config.aiProvider === 'openai' && openai) {
      return await chatWithOpenAI(history, hotelContext);
    } else if (config.aiProvider === 'gemini' && genAI) {
      return await chatWithGemini(history, hotelContext);
    } else if (openai) {
      return await chatWithOpenAI(history, hotelContext);
    } else if (genAI) {
      return await chatWithGemini(history, hotelContext);
    } else {
      // Fallback mock response
      return getMockResponse(message);
    }
  } catch (error) {
    console.error('[AI Service] Error:', error);
    // Try fallback provider
    try {
      if (config.aiProvider === 'openai' && genAI) {
        return await chatWithGemini(history, hotelContext);
      } else if (config.aiProvider === 'gemini' && openai) {
        return await chatWithOpenAI(history, hotelContext);
      }
    } catch (fallbackError) {
      console.error('[AI Service] Fallback also failed:', fallbackError);
    }
    return getMockResponse(message);
  }
}

async function chatWithOpenAI(
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  hotelContext: string
): Promise<string> {
  if (!openai) throw new Error('OpenAI client not initialized');

  const systemPrompt = getConciergeSystemPrompt(hotelContext);
  const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    max_tokens: 200,
    temperature: 0.7,
  });

  const reply = response.choices[0]?.message?.content || 'I apologize, I encountered an issue. How can I assist you?';

  // Add assistant response to history
  history.push({ role: 'assistant', content: reply });

  return reply;
}

async function chatWithGemini(
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  hotelContext: string
): Promise<string> {
  if (!genAI) throw new Error('Gemini client not initialized');

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const systemPrompt = getConciergeSystemPrompt(hotelContext);

  // Convert history to Gemini format
  const geminiHistory = history.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: msg.content }],
  }));

  const chat = model.startChat({
    history: geminiHistory.slice(0, -1), // All but last message
    systemInstruction: systemPrompt,
  });

  const lastMessage = history[history.length - 1];
  const result = await chat.sendMessage(lastMessage.content);
  const reply = result.response.text() || 'I apologize, I encountered an issue. How can I assist you?';

  // Add assistant response to history
  history.push({ role: 'assistant', content: reply });

  return reply;
}

/** Clear session history */
export function clearSession(sessionId: string): void {
  sessionHistory.delete(sessionId);
}

/** Fallback mock responses when no AI API is configured */
function getMockResponse(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('hello') || lower.includes('hi')) {
    return 'Welcome to The Grand Azure Hotel! I\'m Azure, your AI concierge. How can I help you check in today?';
  }
  if (lower.includes('room') || lower.includes('upgrade')) {
    return 'We have some wonderful room options available. Our Deluxe rooms offer stunning ocean views, and our Suites include a private balcony and lounge area.';
  }
  if (lower.includes('breakfast') || lower.includes('restaurant')) {
    return 'Breakfast is served daily from 6:30 AM to 10:30 AM in the Azure Restaurant on the ground floor. We offer both buffet and à la carte options.';
  }
  if (lower.includes('wifi') || lower.includes('internet')) {
    return 'Our complimentary Wi-Fi network is "GrandAzure-Guest" and the password is AZURE2024. You\'ll find it connects automatically in most rooms.';
  }
  if (lower.includes('checkout') || lower.includes('check-out') || lower.includes('check out')) {
    return 'Check-out time is 11:00 AM. If you need a late check-out, I can arrange that for you — just let me know!';
  }

  return 'Thank you for your message. Is there anything specific about your stay I can help you with?';
}
