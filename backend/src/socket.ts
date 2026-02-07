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
  const io = new SocketIOServer(server, {
    cors: {
      origin: ['http://localhost:5173', 'http://localhost:3000'],
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // --- Full voice pipeline via socket (STT → AI → TTS) ---

    socket.on('voice:process', async (data: { audio: ArrayBuffer; sessionId: string }) => {
      try {
        // 1. STT
        socket.emit('voice:transcribing');
        const audioBuffer = Buffer.from(data.audio);
        const transcript = await speechToText(audioBuffer);
        socket.emit('voice:transcribed', { text: transcript });

        // 2. AI Chat
        socket.emit('voice:thinking');
        const reply = await chat(transcript, data.sessionId);
        socket.emit('voice:reply', { text: reply });

        // 3. TTS
        socket.emit('voice:synthesizing');
        const ttsAudio = await textToSpeech(reply);
        socket.emit('voice:audio', { audio: ttsAudio, text: reply });

      } catch (error) {
        console.error('[Socket] Voice pipeline error:', error);
        socket.emit('voice:error', { message: 'Voice processing failed' });
      }
    });

    // --- Simple chat via socket (text only) ---

    socket.on('chat:message', async (data: { message: string; sessionId: string; context?: Record<string, unknown> }) => {
      try {
        socket.emit('chat:thinking');
        const reply = await chat(data.message, data.sessionId, data.context);
        socket.emit('chat:reply', { text: reply });
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
