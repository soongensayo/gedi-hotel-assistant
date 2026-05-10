import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { chat } from './services/aiService';
import { textToSpeech } from './services/ttsService';
import { speechToText } from './services/sttService';

/**
 * Set up Socket.IO server for real-time communication.
 * Handles streaming voice and chat interactions.
 * 
 * Note: Avatar (Simli) runs entirely on the frontend via their WebRTC SDK.
 * The backend only handles AI chat, TTS, and STT.
 */
export function setupSocketIO(server: HTTPServer): SocketIOServer {
  const isDev = process.env.NODE_ENV !== 'production';
  const io = new SocketIOServer(server, {
    cors: {
      origin: isDev
        ? (_origin, cb) => cb(null, true)
        : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 10 * 1024 * 1024, // 10 MB for passport photo transfer
  });

  // Stanford showcase: concierge ↔ guest command relay (namespace /stanford)
  const stanford = io.of('/stanford');
  stanford.on('connection', (socket) => {
    console.log(`[Stanford] New connection: ${socket.id}`);

    socket.on(
      'stanford:join',
      (data: { role: 'guest' | 'staff'; roomId: string }) => {
        const room = `stanford:${data.roomId}`;
        void socket.join(room);
        (socket.data as { stanfordRole?: string; stanfordRoomId?: string }).stanfordRole =
          data.role;
        (socket.data as { stanfordRole?: string; stanfordRoomId?: string }).stanfordRoomId =
          data.roomId;
        console.log(`[Stanford] ${data.role} joined ${room} (${socket.id})`);
      }
    );

    socket.on(
      'stanford:staff_command',
      (payload: { roomId: string; command: unknown }) => {
        const data = socket.data as { stanfordRole?: string };
        if (data.stanfordRole !== 'staff') {
          console.warn('[Stanford] Ignored staff_command from non-staff socket');
          return;
        }
        const room = `stanford:${payload.roomId}`;
        socket.to(room).emit('stanford:guest_command', payload.command);
      }
    );

    socket.on(
      'stanford:guest_event',
      (payload: { roomId: string; event: unknown }) => {
        const data = socket.data as { stanfordRole?: string };
        if (data.stanfordRole !== 'guest') {
          console.warn('[Stanford] Ignored guest_event from non-guest socket');
          return;
        }
        const room = `stanford:${payload.roomId}`;
        socket.to(room).emit('stanford:staff_event', payload.event);
      }
    );

    socket.on('disconnect', () => {
      console.log(`[Stanford] Disconnected: ${socket.id}`);
    });
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // --- Full voice pipeline via socket (STT → AI → TTS) ---

    socket.on('voice:process', async (data: {
      audio: ArrayBuffer;
      sessionId: string;
      context?: Record<string, unknown>;
    }) => {
      try {
        // 1. STT
        socket.emit('voice:transcribing');
        const audioBuffer = Buffer.from(data.audio);
        const transcript = await speechToText(audioBuffer);
        socket.emit('voice:transcribed', { text: transcript });

        // 2. AI Chat (with context and function calling)
        socket.emit('voice:thinking');
        const { reply, actions } = await chat(transcript, data.sessionId, data.context);
        socket.emit('voice:reply', { text: reply, actions });

        // 3. TTS
        socket.emit('voice:synthesizing');
        const ttsAudio = await textToSpeech(reply);
        socket.emit('voice:audio', { audio: ttsAudio, text: reply, actions });

      } catch (error) {
        console.error('[Socket] Voice pipeline error:', error);
        socket.emit('voice:error', { message: 'Voice processing failed' });
      }
    });

    // --- Simple chat via socket (text only) ---

    socket.on('chat:message', async (data: {
      message: string;
      sessionId: string;
      context?: Record<string, unknown>;
    }) => {
      try {
        socket.emit('chat:thinking');
        const { reply, actions } = await chat(data.message, data.sessionId, data.context);
        socket.emit('chat:reply', { text: reply, actions });
      } catch (error) {
        console.error('[Socket] Chat error:', error);
        socket.emit('chat:error', { message: 'Chat processing failed' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}
