import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import { getConciergeSystemPrompt, buildHotelContext } from '../prompts/concierge';
import {
  getHotelInfo,
  getAvailableRooms,
  getRoomUpgrades,
  lookupReservation,
  lookupReservationByPassport,
  lookupReservationByName,
} from './hotelService';

// =============================================================================
// Types
// =============================================================================

/** An action the AI wants the frontend to perform */
export interface AIAction {
  type:
    | 'set_step'
    | 'show_passport_scanner'
    | 'show_payment'
    | 'show_key_card'
    | 'store_reservation';
  /** Optional payload — e.g. the step name for set_step, or reservation data */
  payload?: Record<string, unknown>;
}

export interface ChatResult {
  reply: string;
  actions: AIAction[];
}

// =============================================================================
// Clients
// =============================================================================

const openai = config.openaiApiKey
  ? new OpenAI({ apiKey: config.openaiApiKey })
  : null;

const genAI = config.geminiApiKey
  ? new GoogleGenerativeAI(config.geminiApiKey)
  : null;

// In-memory conversation history per session
const sessionHistory: Map<
  string,
  Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
> = new Map();

// =============================================================================
// Tool Definitions for OpenAI Function Calling
// =============================================================================

const CONCIERGE_TOOLS: OpenAI.ChatCompletionTool[] = [
  // --- Data tools (query Supabase / mock data) ---
  {
    type: 'function',
    function: {
      name: 'lookup_reservation',
      description: 'Look up a guest reservation by confirmation code or reservation ID.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The confirmation code (e.g. GAH-2024-001) or reservation ID.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_reservation_by_name',
      description:
        'Look up a reservation by the guest\'s first and last name. This is the most common way guests identify themselves — use this when a guest tells you their name.',
      parameters: {
        type: 'object',
        properties: {
          firstName: {
            type: 'string',
            description: 'The guest\'s first name.',
          },
          lastName: {
            type: 'string',
            description: 'The guest\'s last name.',
          },
        },
        required: ['firstName', 'lastName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_reservation_by_passport',
      description: 'Look up a reservation using the guest passport number.',
      parameters: {
        type: 'object',
        properties: {
          passportNumber: {
            type: 'string',
            description: 'The passport number to search for.',
          },
        },
        required: ['passportNumber'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_hotel_info',
      description:
        'Get hotel details including amenities, Wi-Fi password, breakfast times, check-in/out times, nearby attractions, and contact info.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_available_rooms',
      description: 'Get a list of currently available hotel rooms with types, prices, and amenities.',
      parameters: {
        type: 'object',
        properties: {
          checkIn: { type: 'string', description: 'Check-in date (YYYY-MM-DD). Optional.' },
          checkOut: { type: 'string', description: 'Check-out date (YYYY-MM-DD). Optional.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_room_upgrades',
      description: 'Get available room upgrades from a given room type.',
      parameters: {
        type: 'object',
        properties: {
          currentRoomType: {
            type: 'string',
            description: 'Current room type: standard, deluxe, suite, or penthouse.',
          },
        },
        required: ['currentRoomType'],
      },
    },
  },

  // --- Action tools (trigger frontend UI changes) ---
  {
    type: 'function',
    function: {
      name: 'trigger_passport_scan',
      description:
        'Show the passport scanner UI so the guest can scan their passport. Call this when you need to verify the guest identity via passport.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trigger_payment',
      description:
        'Show the payment / credit card UI so the guest can complete payment. Call this when the reservation details are confirmed and you are ready to collect payment.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dispense_key_card',
      description:
        'Show the key card dispensing screen. Call this after payment is successful to issue the room key card.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_checkin_step',
      description:
        'Update the check-in progress bar to a specific step. Use this to keep the UI in sync with the conversation flow.',
      parameters: {
        type: 'object',
        properties: {
          step: {
            type: 'string',
            enum: [
              'welcome',
              'identify',
              'passport-scan',
              'reservation-found',
              'room-selection',
              'upgrade-offer',
              'payment',
              'key-card',
              'farewell',
            ],
            description: 'The check-in step to navigate to.',
          },
        },
        required: ['step'],
      },
    },
  },
];

// =============================================================================
// Tool Execution
// =============================================================================

/**
 * Execute a tool call and return the result + any frontend actions.
 */
async function executeToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ result: unknown; action?: AIAction }> {
  switch (name) {
    // --- Data tools ---
    case 'lookup_reservation': {
      const data = await lookupReservation(args.query as string);
      if (data) {
        return {
          result: data,
          action: { type: 'store_reservation', payload: data as unknown as Record<string, unknown> },
        };
      }
      return { result: { error: 'No reservation found with that code.' } };
    }
    case 'lookup_reservation_by_name': {
      const { reservation, suggestions } = await lookupReservationByName(
        args.firstName as string,
        args.lastName as string
      );
      if (reservation) {
        return {
          result: reservation,
          action: { type: 'store_reservation', payload: reservation as unknown as Record<string, unknown> },
        };
      }
      if (suggestions.length > 0) {
        return {
          result: {
            error: `No exact match found for '${args.firstName} ${args.lastName}'.`,
            didYouMean: suggestions.map((s) => `${s.firstName} ${s.lastName}`),
            hint: 'Ask the guest politely if they meant one of these names. When they confirm, call lookup_reservation_by_name again with the corrected name.',
          },
        };
      }
      return { result: { error: 'No reservation found for that name. Ask the guest for a confirmation code or passport number instead.' } };
    }
    case 'lookup_reservation_by_passport': {
      const data = await lookupReservationByPassport(args.passportNumber as string);
      if (data) {
        return {
          result: data,
          action: { type: 'store_reservation', payload: data as unknown as Record<string, unknown> },
        };
      }
      return { result: { error: 'No reservation found for that passport.' } };
    }
    case 'get_hotel_info': {
      const data = await getHotelInfo();
      return { result: data };
    }
    case 'get_available_rooms': {
      const data = await getAvailableRooms(
        args.checkIn as string | undefined,
        args.checkOut as string | undefined
      );
      return { result: data };
    }
    case 'get_room_upgrades': {
      const data = await getRoomUpgrades(args.currentRoomType as string);
      return { result: data };
    }

    // --- Action tools (side-effects for frontend) ---
    case 'trigger_passport_scan':
      return {
        result: { success: true, message: 'Passport scanner UI displayed to guest.' },
        action: { type: 'show_passport_scanner' },
      };
    case 'trigger_payment':
      return {
        result: { success: true, message: 'Payment UI displayed to guest.' },
        action: { type: 'show_payment' },
      };
    case 'dispense_key_card':
      return {
        result: { success: true, message: 'Key card screen displayed to guest.' },
        action: { type: 'show_key_card' },
      };
    case 'set_checkin_step':
      return {
        result: { success: true, message: `Check-in step set to: ${args.step}` },
        action: { type: 'set_step', payload: { step: args.step } },
      };

    default:
      return { result: { error: `Unknown tool: ${name}` } };
  }
}

// =============================================================================
// Main Chat Function
// =============================================================================

/**
 * Send a message to the AI and get a response with optional frontend actions.
 * Uses OpenAI with function calling by default, falls back to Gemini (no tools).
 */
export async function chat(
  message: string,
  sessionId: string,
  context?: Record<string, unknown>
): Promise<ChatResult> {
  // Get or create session history
  if (!sessionHistory.has(sessionId)) {
    sessionHistory.set(sessionId, []);
  }
  const history = sessionHistory.get(sessionId)!;

  // Build hotel context
  const hotelContext = context
    ? buildHotelContext(context as {
        hotelInfo?: Record<string, unknown>;
        reservation?: Record<string, unknown>;
        guest?: Record<string, unknown>;
        selectedRoom?: Record<string, unknown>;
        selectedUpgrade?: Record<string, unknown>;
        currentStep?: string;
      })
    : '';

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
      const reply = await chatWithGemini(history, hotelContext);
      return { reply, actions: [] };
    } else if (openai) {
      return await chatWithOpenAI(history, hotelContext);
    } else if (genAI) {
      const reply = await chatWithGemini(history, hotelContext);
      return { reply, actions: [] };
    } else {
      return { reply: getMockResponse(message), actions: [] };
    }
  } catch (error) {
    console.error('[AI Service] Error:', error);
    // Try fallback provider
    try {
      if (config.aiProvider === 'openai' && genAI) {
        const reply = await chatWithGemini(history, hotelContext);
        return { reply, actions: [] };
      } else if (config.aiProvider === 'gemini' && openai) {
        return await chatWithOpenAI(history, hotelContext);
      }
    } catch (fallbackError) {
      console.error('[AI Service] Fallback also failed:', fallbackError);
    }
    return { reply: getMockResponse(message), actions: [] };
  }
}

// =============================================================================
// OpenAI with Function Calling
// =============================================================================

async function chatWithOpenAI(
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  hotelContext: string
): Promise<ChatResult> {
  if (!openai) throw new Error('OpenAI client not initialized');

  const systemPrompt = getConciergeSystemPrompt(hotelContext);

  // Build messages array for the API call (don't mutate history with system msg)
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
  ];

  const actions: AIAction[] = [];
  let maxIterations = 5; // safety cap on tool-call loops

  while (maxIterations-- > 0) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools: CONCIERGE_TOOLS,
      tool_choice: 'auto',
      max_tokens: 300,
      temperature: 0.7,
    });

    const choice = response.choices[0];
    const assistantMsg = choice?.message;

    if (!assistantMsg) {
      break;
    }

    // If no tool calls, we have the final text reply
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      const reply =
        assistantMsg.content ||
        'I apologize, I encountered an issue. How can I assist you?';
      // Add final reply to session history
      history.push({ role: 'assistant', content: reply });
      return { reply, actions };
    }

    // Add assistant message (with tool calls) to the messages array
    messages.push(assistantMsg);

    // Execute each tool call
    for (const toolCall of assistantMsg.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }

      console.log(`[AI Service] Tool call: ${toolCall.function.name}`, args);

      const { result, action } = await executeToolCall(
        toolCall.function.name,
        args
      );

      if (action) {
        actions.push(action);
      }

      // Feed the tool result back to the LLM
      messages.push({
        role: 'tool' as const,
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  // If we exhausted iterations, return what we have
  const fallbackReply = 'Let me help you with that. Could you tell me a bit more?';
  history.push({ role: 'assistant', content: fallbackReply });
  return { reply: fallbackReply, actions };
}

// =============================================================================
// Gemini (no function calling — plain chat)
// =============================================================================

async function chatWithGemini(
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  hotelContext: string
): Promise<string> {
  if (!genAI) throw new Error('Gemini client not initialized');

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const systemPrompt = getConciergeSystemPrompt(hotelContext);

  // Convert history to Gemini format
  const geminiHistory = history.map((msg) => ({
    role: msg.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: msg.content }],
  }));

  const chat = model.startChat({
    history: geminiHistory.slice(0, -1),
    systemInstruction: systemPrompt,
  });

  const lastMessage = history[history.length - 1];
  const result = await chat.sendMessage(lastMessage.content);
  const reply =
    result.response.text() ||
    'I apologize, I encountered an issue. How can I assist you?';

  history.push({ role: 'assistant', content: reply });
  return reply;
}

// =============================================================================
// Utilities
// =============================================================================

/** Clear session history */
export function clearSession(sessionId: string): void {
  sessionHistory.delete(sessionId);
}

/** Fallback mock responses when no AI API is configured */
function getMockResponse(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('hello') || lower.includes('hi')) {
    return "Welcome to The Grand Azure Hotel! I'm Azure, your AI concierge. How can I help you check in today?";
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
  if (
    lower.includes('checkout') ||
    lower.includes('check-out') ||
    lower.includes('check out')
  ) {
    return 'Check-out time is 11:00 AM. If you need a late check-out, I can arrange that for you — just let me know!';
  }

  return 'Thank you for your message. Is there anything specific about your stay I can help you with?';
}
