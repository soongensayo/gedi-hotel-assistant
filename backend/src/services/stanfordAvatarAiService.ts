import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import {
  getHotelInfo,
  lookupReservation,
  lookupReservationByName,
} from './hotelService';

export interface StanfordAvatarAction {
  type:
    | 'store_reservation'
    | 'capture_passport_photo'
    | 'show_reservation'
    | 'show_payment'
    | 'show_key_card'
    | 'end_session';
  payload?: Record<string, unknown>;
}

export interface StanfordAvatarChatResult {
  reply: string;
  actions: StanfordAvatarAction[];
}

const openai = config.openaiApiKey
  ? new OpenAI({ apiKey: config.openaiApiKey })
  : null;

const genAI = config.geminiApiKey
  ? new GoogleGenerativeAI(config.geminiApiKey)
  : null;

const sessionHistory = new Map<
  string,
  Array<{ role: 'user' | 'assistant'; content: string }>
>();
const pendingDemoGuestNames = new Map<string, string>();

const STANFORD_AVATAR_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'lookup_reservation',
      description: 'Look up a reservation by confirmation code or reservation ID.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Confirmation code or reservation ID.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_reservation_by_name',
      description: 'Look up a reservation by guest first and last name.',
      parameters: {
        type: 'object',
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
        },
        required: ['firstName', 'lastName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_hotel_info',
      description: 'Get hotel amenities, Wi-Fi, dining, local recommendations, and property details.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'capture_passport_photo',
      description:
        'Open the Stanford guest camera passport screen and auto-capture a passport photo. Use after finding the reservation.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_reservation',
      description:
        'Show the Stanford reservation confirmation screen. Use after the passport photo has been captured.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_payment',
      description:
        'Show the Stanford NFC payment screen. Use after the guest confirms the reservation details.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_key_card',
      description:
        'Show the Stanford key-card encoder/dispenser screen. Use after payment succeeds.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_checkin',
      description:
        'End the avatar-led check-in after the physical key card has been issued and received.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'register_demo_guest',
      description:
        'Create a fictitious Stanford showcase reservation for the confirmed guest name and continue avatar check-in.',
      parameters: {
        type: 'object',
        properties: {
          guestName: {
            type: 'string',
            description: 'The guest name exactly as confirmed by the guest.',
          },
        },
        required: ['guestName'],
      },
    },
  },
];

function buildStanfordAvatarPrompt(context?: Record<string, unknown>): string {
  const ctx = context ? JSON.stringify(context) : 'No current context.';
  return `You are Azure, the AI avatar concierge for the Stanford hotel showcase.

You control a guest kiosk with the same Stanford hardware used by the remote-concierge demo:
- guest webcam passport photo capture
- NFC payment reader
- physical key-card encoder and dispenser

Keep every spoken response short, natural, and demo-friendly: one or two sentences.
Do not mention tool names, implementation details, or markdown.

Primary check-in flow:
1. If the guest wants to check in, ask for their full name or confirmation code.
2. For this showcase, any guest name is acceptable. When the guest gives a name, confirm it first.
3. Once the guest confirms the name, call register_demo_guest with that name. This creates a fictitious reservation, greets the guest by name, and opens passport photo capture. Then stop and wait.
4. When context or the user says the passport photo was captured, call show_reservation and ask the guest to confirm the details.
5. When the guest confirms the reservation, call show_payment and ask them to tap their card or phone on the NFC reader.
6. When context or the user says payment is complete, call show_key_card and tell them the physical key card is being prepared.
7. When context or the user says the key card was received, call complete_checkin. Then welcome them and offer normal concierge help.

After check-in, you can answer hotel questions using get_hotel_info. Never invent reservation, hotel, or hardware details.

Current context:
${ctx}`;
}

function createDemoReservation(guestName: string): Record<string, unknown> {
  const cleanName = guestName.trim().replace(/\s+/g, ' ') || 'Stanford Guest';
  const [firstName, ...lastNameParts] = cleanName.split(' ');
  const lastName = lastNameParts.join(' ') || 'Guest';
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const checkout = new Date(now);
  checkout.setDate(now.getDate() + 3);

  return {
    id: `avatar-demo-${suffix}`,
    confirmationCode: `STAN-${suffix}`,
    guestId: `avatar-guest-${suffix}`,
    guest: {
      id: `avatar-guest-${suffix}`,
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/\s+/g, '')}@example.com`,
      nationality: 'Demo',
      preferredName: firstName,
      loyaltyTier: 'Showcase',
      vipNotes: 'Avatar-led Stanford showcase guest.',
    },
    roomId: 'avatar-room-712',
    room: {
      id: 'avatar-room-712',
      roomNumber: '712',
      type: 'Premier King',
      floor: 7,
      pricePerNight: 420,
      currency: 'USD',
      maxOccupancy: 2,
      bedType: 'King',
      amenities: ['Campus view', 'Quiet floor', 'Evening turndown'],
      description: 'A fictitious Stanford showcase room for avatar check-in demos.',
    },
    checkInDate: tomorrow.toISOString().slice(0, 10),
    checkOutDate: checkout.toISOString().slice(0, 10),
    numberOfGuests: 1,
    status: 'confirmed',
    specialRequests: 'Fictitious avatar demo reservation.',
    totalAmount: 840,
    currency: 'USD',
    source: 'avatar-demo',
    arrivalStatus: 'arrived',
    paymentStatus: 'pending',
    scheduledArrivalAt: now.toISOString(),
  };
}

function normalizeDemoGuestName(message: string): string | null {
  const stripped = message
    .replace(/[.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lowered = stripped.toLowerCase();
  if (!stripped || /^(hi|hello|hey|yes|yeah|yep|correct|that is right|confirm|confirmed)$/i.test(stripped)) {
    return null;
  }
  if (lowered.includes('check in') && stripped.split(' ').length <= 5) return null;

  const patterns = [
    /(?:my name is|i am|i'm|this is|name is|under)\s+(.+)$/i,
    /(?:check me in as|register me as)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = stripped.match(pattern);
    if (match?.[1]) return titleCaseName(match[1]);
  }

  const words = stripped.split(' ').filter((word) => /^[a-zA-Z'-]+$/.test(word));
  if (words.length >= 1 && words.length <= 4 && words.length === stripped.split(' ').length) {
    return titleCaseName(words.join(' '));
  }
  return null;
}

function titleCaseName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function isAffirmative(message: string): boolean {
  return /\b(yes|yeah|yep|correct|confirm|confirmed|that's right|that is right|proceed|go ahead|sounds good)\b/i.test(message);
}

function hasReservationContext(context?: Record<string, unknown>): boolean {
  return Boolean(context?.reservation);
}

function messageMentions(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

async function executeToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ result: unknown; action?: StanfordAvatarAction }> {
  switch (name) {
    case 'lookup_reservation': {
      const reservation = await lookupReservation(String(args.query ?? ''));
      if (!reservation) return { result: { error: 'No reservation found.' } };
      return {
        result: reservation,
        action: {
          type: 'store_reservation',
          payload: reservation as unknown as Record<string, unknown>,
        },
      };
    }
    case 'lookup_reservation_by_name': {
      const { reservation, suggestions } = await lookupReservationByName(
        String(args.firstName ?? ''),
        String(args.lastName ?? '')
      );
      if (reservation) {
        return {
          result: reservation,
          action: {
            type: 'store_reservation',
            payload: reservation as unknown as Record<string, unknown>,
          },
        };
      }
      return {
        result: suggestions.length
          ? {
              error: 'No exact match.',
              didYouMean: suggestions.map((s) => `${s.firstName} ${s.lastName}`),
            }
          : { error: 'No reservation found for that name.' },
      };
    }
    case 'get_hotel_info':
      return { result: await getHotelInfo() };
    case 'capture_passport_photo':
      return {
        result: { success: true, message: 'Guest camera passport capture opened.' },
        action: { type: 'capture_passport_photo' },
      };
    case 'show_reservation':
      return {
        result: { success: true, message: 'Reservation confirmation shown.' },
        action: { type: 'show_reservation' },
      };
    case 'show_payment':
      return {
        result: { success: true, message: 'NFC payment screen shown.' },
        action: {
          type: 'show_payment',
          payload: {
            qrValue: 'avatar-payment-demo',
            instructions: 'Tap your card or phone on the NFC reader to complete payment.',
          },
        },
      };
    case 'show_key_card':
      return {
        result: { success: true, message: 'Key-card dispenser screen shown.' },
        action: { type: 'show_key_card' },
      };
    case 'complete_checkin':
      return {
        result: { success: true, message: 'Avatar check-in complete.' },
        action: { type: 'end_session' },
      };
    case 'register_demo_guest': {
      const reservation = createDemoReservation(String(args.guestName ?? 'Stanford Guest'));
      return {
        result: reservation,
        action: {
          type: 'store_reservation',
          payload: reservation,
        },
      };
    }
    default:
      return { result: { error: `Unknown tool: ${name}` } };
  }
}

export async function chatWithStanfordAvatar(
  message: string,
  sessionId: string,
  context?: Record<string, unknown>
): Promise<StanfordAvatarChatResult> {
  if (!context?.reservation) {
    const pendingName = pendingDemoGuestNames.get(sessionId);
    if (pendingName && isAffirmative(message)) {
      pendingDemoGuestNames.delete(sessionId);
      const reservation = createDemoReservation(pendingName);
      const firstName = pendingName.split(' ')[0] || pendingName;
      return {
        reply: `Perfect, ${firstName}. I have your demo reservation ready, and I will take a quick passport photo now.`,
        actions: [
          { type: 'store_reservation', payload: reservation },
          { type: 'capture_passport_photo' },
        ],
      };
    }

    const demoName = normalizeDemoGuestName(message);
    if (demoName) {
      pendingDemoGuestNames.set(sessionId, demoName);
      return {
        reply: `Just to confirm, should I check you in as ${demoName}?`,
        actions: [],
      };
    }
  }

  if (hasReservationContext(context)) {
    if (
      !context?.passportPhotoCaptured &&
      messageMentions(message, [/passport photo captured/i, /passport.*captured/i])
    ) {
      return {
        reply: 'Great, thank you. Please take a moment to review your reservation details on screen.',
        actions: [{ type: 'show_reservation' }],
      };
    }

    if (
      !context?.paymentComplete &&
      messageMentions(message, [/reservation.*confirm/i, /\bi confirm\b/i, /\bconfirmed\b/i])
    ) {
      return {
        reply: 'Thank you. Please tap your card or phone on the NFC reader to complete payment.',
        actions: [
          {
            type: 'show_payment',
            payload: {
              qrValue: 'avatar-payment-demo',
              instructions: 'Tap your card or phone on the NFC reader to complete payment.',
            },
          },
        ],
      };
    }

    if (
      !context?.keyCardReceived &&
      messageMentions(message, [/payment completed/i, /payment complete/i, /nfc tap/i])
    ) {
      return {
        reply: 'Payment is complete. I am preparing and dispensing your physical room key now.',
        actions: [{ type: 'show_key_card' }],
      };
    }

    if (messageMentions(message, [/key card.*received/i, /key card.*issued/i, /i have.*key/i])) {
      return {
        reply: 'You are all checked in. Welcome, and I can help with directions, dining, or anything else during your stay.',
        actions: [{ type: 'end_session' }],
      };
    }
  }

  if (!sessionHistory.has(sessionId)) {
    sessionHistory.set(sessionId, []);
  }
  const history = sessionHistory.get(sessionId)!;
  history.push({ role: 'user', content: message });
  if (history.length > 24) history.splice(0, history.length - 24);

  try {
    if (openai) {
      return await chatWithOpenAI(history, context);
    }

    if (genAI) {
      const reply = await chatWithGemini(history, context);
      return { reply, actions: [] };
    }
  } catch (error) {
    console.error('[Stanford Avatar AI] Chat error:', error);
  }

  const reply = getMockReply(message, context);
  history.push({ role: 'assistant', content: reply });
  return { reply, actions: [] };
}

async function chatWithOpenAI(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  context?: Record<string, unknown>
): Promise<StanfordAvatarChatResult> {
  if (!openai) throw new Error('OpenAI client not initialized');

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildStanfordAvatarPrompt(context) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  const actions: StanfordAvatarAction[] = [];
  let maxIterations = 5;

  while (maxIterations-- > 0) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools: STANFORD_AVATAR_TOOLS,
      tool_choice: 'auto',
      max_tokens: 260,
      temperature: 0.55,
    });

    const assistantMsg = response.choices[0]?.message;
    if (!assistantMsg) break;

    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      const reply = assistantMsg.content || 'I can help with that. What would you like to do next?';
      history.push({ role: 'assistant', content: reply });
      return { reply, actions };
    }

    messages.push(assistantMsg);

    for (const toolCall of assistantMsg.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }

      console.log(`[Stanford Avatar AI] Tool call: ${toolCall.function.name}`, args);
      const { result, action } = await executeToolCall(toolCall.function.name, args);
      if (action) actions.push(action);
      if (toolCall.function.name === 'register_demo_guest') {
        actions.push({ type: 'capture_passport_photo' });
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  const reply = 'Let me keep your check-in moving. Could you repeat that for me?';
  history.push({ role: 'assistant', content: reply });
  return { reply, actions };
}

async function chatWithGemini(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  context?: Record<string, unknown>
): Promise<string> {
  if (!genAI) throw new Error('Gemini client not initialized');

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const geminiHistory = history.map((msg) => ({
    role: msg.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: msg.content }],
  }));
  const chat = model.startChat({
    history: geminiHistory.slice(0, -1),
    systemInstruction: buildStanfordAvatarPrompt(context),
  });
  const result = await chat.sendMessage(history[history.length - 1].content);
  const reply = result.response.text() || 'I can help with your check-in.';
  history.push({ role: 'assistant', content: reply });
  return reply;
}

function getMockReply(message: string, context?: Record<string, unknown>): string {
  const lower = message.toLowerCase();
  if (context?.keyCardReceived) {
    return 'You are all checked in. Welcome, and I can help with directions, dining, or anything else during your stay.';
  }
  if (context?.paymentComplete) {
    return 'Payment is complete. I am preparing your physical room key now.';
  }
  if (context?.passportPhotoCaptured) {
    return 'Thank you, I have your passport photo. Please confirm the reservation details on screen.';
  }
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('check')) {
    return 'Welcome. I can help you check in here with your name or confirmation code.';
  }
  return 'I can help with that. For check-in, please tell me your full name or confirmation code.';
}

export function clearStanfordAvatarSession(sessionId: string): void {
  sessionHistory.delete(sessionId);
  pendingDemoGuestNames.delete(sessionId);
}
