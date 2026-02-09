import { useState, useRef, useCallback, useEffect } from 'react';
import { transcribeAudio } from '../services/api';
import { useConversationStore } from '../stores/conversationStore';

// ── VAD Configuration ────────────────────────────────────────────────
// These thresholds work well for a quiet hotel kiosk environment.
// Adjust SPEECH_THRESHOLD up if there's ambient noise (e.g. lobby music).
const VAD_CONFIG = {
  SPEECH_THRESHOLD: 0.012,    // RMS level that counts as "someone is talking"
  SILENCE_THRESHOLD: 0.008,   // RMS level that counts as "silence"
  SPEECH_START_MS: 250,       // Sustained speech before we start recording
  SILENCE_DURATION_MS: 1500,  // Sustained silence before we stop recording
  MIN_RECORDING_MS: 600,      // Minimum recording length to bother transcribing
  VAD_INTERVAL_MS: 50,        // How often we sample audio levels (20 fps)
};

interface UseVoiceInputReturn {
  /** Mic is open and VAD is actively monitoring */
  isListening: boolean;
  /** VAD detected speech — MediaRecorder is capturing */
  isRecording: boolean;
  /** Audio is being sent to Whisper for transcription */
  isProcessing: boolean;
  /** Current audio level (0-1) for visual feedback */
  audioLevel: number;
  /** Open the mic and start hands-free VAD */
  startListening: () => Promise<void>;
  /** Close the mic and stop everything */
  stopListening: () => void;
}

/**
 * Hands-free voice input with Voice Activity Detection.
 *
 * The mic stays open while in "listening" mode. Audio energy is monitored
 * via an AnalyserNode (~20×/sec, zero API calls). When speech is detected
 * (sustained volume above threshold), a MediaRecorder captures the audio.
 * When the user stops talking (silence for ~1.5s), the recording is sent
 * to Whisper for transcription and the callback fires.
 *
 * Detection is automatically **paused** while the AI is speaking or loading
 * to prevent echo / feedback loops.
 *
 * @param onTranscript — Called with the transcribed text when an utterance completes.
 *                       Kept in a ref so the latest closure is always used.
 */
export function useVoiceInput(
  onTranscript: (text: string) => void
): UseVoiceInputReturn {
  // ── React state (drives UI) ───────────────────────────────────────
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  // ── Refs for resources & mutable state ─────────────────────────────
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const vadIntervalRef = useRef<number | null>(null);

  // VAD timing refs (must be refs so the setInterval callback sees latest values)
  const speechStartTimeRef = useRef<number | null>(null);
  const silenceStartTimeRef = useRef<number | null>(null);
  const recordingStartTimeRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);
  const isProcessingRef = useRef(false);

  // Keep the callback ref always in sync with the latest closure
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const setError = useConversationStore((s) => s.setError);

  // ── Helpers ────────────────────────────────────────────────────────

  /** Compute RMS (root-mean-square) energy from the AnalyserNode. */
  const getRMS = useCallback((): number => {
    if (!analyserRef.current) return 0;
    const bufferLength = analyserRef.current.fftSize;
    const dataArray = new Float32Array(bufferLength);
    analyserRef.current.getFloatTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    return Math.sqrt(sum / bufferLength);
  }, []);

  /** Begin capturing audio into MediaRecorder (called when VAD detects speech). */
  const startSegmentRecording = useCallback(() => {
    if (!streamRef.current || isRecordingRef.current) return;

    audioChunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    mediaRecorderRef.current = recorder;
    recorder.start(100); // collect chunks every 100 ms
    recordingStartTimeRef.current = Date.now();
    isRecordingRef.current = true;
    setIsRecording(true);
    console.log('[VAD] Speech detected — recording started');
  }, []);

  /** Stop the MediaRecorder, transcribe, and fire the callback. */
  const stopSegmentAndTranscribe = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    // We don't await this — the onstop handler runs asynchronously
    recorder.onstop = async () => {
      isRecordingRef.current = false;
      setIsRecording(false);

      const duration = Date.now() - (recordingStartTimeRef.current ?? 0);
      console.log(`[VAD] Recording stopped — ${duration}ms`);

      if (duration < VAD_CONFIG.MIN_RECORDING_MS) {
        console.log('[VAD] Too short, ignoring');
        return;
      }

      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      if (audioBlob.size < 1000) {
        console.log('[VAD] Audio blob too small, ignoring');
        return;
      }

      isProcessingRef.current = true;
      setIsProcessing(true);
      try {
        const { text } = await transcribeAudio(audioBlob);
        if (text?.trim() && onTranscriptRef.current) {
          console.log('[VAD] Transcript:', text.trim());
          onTranscriptRef.current(text.trim());
        }
      } catch (err) {
        console.error('[VAD] Transcription failed:', err);
      } finally {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    };
    recorder.stop();
  }, []);

  // ── Public API ─────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;
      audioContextRef.current = audioContext;

      // ── Start the VAD monitoring interval ─────────────────────────
      vadIntervalRef.current = window.setInterval(() => {
        const now = Date.now();
        const rms = getRMS();

        // Update visual audio level (scaled for display)
        setAudioLevel(Math.min(1, rms * 15));

        // ── Pause detection when AI is active ───────────────────────
        const { isSpeaking, isLoading } = useConversationStore.getState();
        if (isSpeaking || isLoading || isProcessingRef.current) {
          speechStartTimeRef.current = null;
          silenceStartTimeRef.current = null;
          // If we were mid-recording and the AI started speaking, discard
          if (isRecordingRef.current && isSpeaking) {
            mediaRecorderRef.current?.stop();
            isRecordingRef.current = false;
            setIsRecording(false);
          }
          return;
        }

        // ── VAD state machine ───────────────────────────────────────
        if (!isRecordingRef.current) {
          // State: IDLE — waiting for speech onset
          if (rms > VAD_CONFIG.SPEECH_THRESHOLD) {
            if (!speechStartTimeRef.current) {
              speechStartTimeRef.current = now;
            } else if (now - speechStartTimeRef.current >= VAD_CONFIG.SPEECH_START_MS) {
              startSegmentRecording();
              silenceStartTimeRef.current = null;
            }
          } else {
            speechStartTimeRef.current = null;
          }
        } else {
          // State: RECORDING — waiting for silence to end the segment
          if (rms < VAD_CONFIG.SILENCE_THRESHOLD) {
            if (!silenceStartTimeRef.current) {
              silenceStartTimeRef.current = now;
            } else if (now - silenceStartTimeRef.current >= VAD_CONFIG.SILENCE_DURATION_MS) {
              stopSegmentAndTranscribe();
              speechStartTimeRef.current = null;
              silenceStartTimeRef.current = null;
            }
          } else {
            // Speech resumed — reset silence timer
            silenceStartTimeRef.current = null;
          }
        }
      }, VAD_CONFIG.VAD_INTERVAL_MS);

      setIsListening(true);
      console.log('[VAD] Listening started — hands-free mode active');
    } catch (err) {
      console.error('[VAD] Failed to start listening:', err);
      setError('Microphone access denied. Please allow microphone access.');
    }
  }, [getRMS, startSegmentRecording, stopSegmentAndTranscribe, setError]);

  const stopListening = useCallback(() => {
    // Clear the VAD interval
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }

    // Stop any active MediaRecorder without triggering transcription
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null; // discard pending audio
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Close audio context
    audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;

    // Stop mic stream
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    // Reset all state
    speechStartTimeRef.current = null;
    silenceStartTimeRef.current = null;
    recordingStartTimeRef.current = null;
    isRecordingRef.current = false;
    isProcessingRef.current = false;

    setIsListening(false);
    setIsRecording(false);
    setIsProcessing(false);
    setAudioLevel(0);
    console.log('[VAD] Listening stopped');
  }, []);

  // ── Cleanup on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close();
    };
  }, []);

  return {
    isListening,
    isRecording,
    isProcessing,
    audioLevel,
    startListening,
    stopListening,
  };
}
