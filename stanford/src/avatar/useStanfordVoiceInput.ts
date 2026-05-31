import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribeAudio } from '../services/api';

const VAD_CONFIG = {
  SPEECH_THRESHOLD: 0.04,
  SILENCE_THRESHOLD: 0.03,
  SPEECH_START_MS: 120,
  SILENCE_DURATION_MS: 950,
  MIN_RECORDING_MS: 600,
  VAD_INTERVAL_MS: 50,
  INTERRUPT_SPEECH_THRESHOLD: 0.08,
};

type Options = {
  busy: boolean;
  speaking: boolean;
  onTranscript: (text: string) => void;
  onInterrupt: () => void;
};

export function useStanfordVoiceInput({
  busy,
  speaking,
  onTranscript,
  onInterrupt,
}: Options) {
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<number | null>(null);
  const speechStartRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const interruptStartRef = useRef<number | null>(null);
  const busyRef = useRef(busy);
  const speakingRef = useRef(speaking);
  const onTranscriptRef = useRef(onTranscript);
  const onInterruptRef = useRef(onInterrupt);

  useEffect(() => {
    busyRef.current = busy;
    speakingRef.current = speaking;
    onTranscriptRef.current = onTranscript;
    onInterruptRef.current = onInterrupt;
  }, [busy, speaking, onTranscript, onInterrupt]);

  const getRms = useCallback(() => {
    if (!analyserRef.current) return 0;
    const data = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(data);
    let sum = 0;
    for (const sample of data) sum += sample * sample;
    return Math.sqrt(sum / data.length);
  }, []);

  const startRecording = useCallback(() => {
    if (!streamRef.current || recorderRef.current) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start(100);
    recorderRef.current = recorder;
    recordingStartRef.current = Date.now();
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    const duration = Date.now() - (recordingStartRef.current ?? 0);
    setIsRecording(false);
    recorderRef.current = null;

    if (duration < VAD_CONFIG.MIN_RECORDING_MS) {
      recorder.onstop = null;
      recorder.stop();
      chunksRef.current = [];
      return;
    }

    recorder.onstop = () => {
      const audioBlob = new Blob(chunksRef.current, {
        type: recorder.mimeType || 'audio/webm',
      });
      chunksRef.current = [];
      if (audioBlob.size < 1000) return;

      setIsProcessing(true);
      transcribeAudio(audioBlob)
        .then(({ text }) => {
          const clean = text.trim();
          if (clean) onTranscriptRef.current(clean);
        })
        .catch((error) => console.error('[Stanford Avatar Voice] STT failed:', error))
        .finally(() => setIsProcessing(false));
    };
    recorder.stop();
  }, []);

  const stopListening = useCallback(() => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
    chunksRef.current = [];
    speechStartRef.current = null;
    silenceStartRef.current = null;
    interruptStartRef.current = null;
    setIsListening(false);
    setIsRecording(false);
    setIsProcessing(false);
    setAudioLevel(0);
  }, []);

  const startListening = useCallback(async () => {
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
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    intervalRef.current = window.setInterval(() => {
      const now = Date.now();
      const rms = getRms();
      setAudioLevel(Math.min(1, rms * 15));

      if (speakingRef.current && rms > VAD_CONFIG.INTERRUPT_SPEECH_THRESHOLD) {
        if (!interruptStartRef.current) interruptStartRef.current = now;
        if (now - interruptStartRef.current >= VAD_CONFIG.SPEECH_START_MS) {
          onInterruptRef.current();
          interruptStartRef.current = null;
          startRecording();
        }
        return;
      }
      interruptStartRef.current = null;

      if (busyRef.current || speakingRef.current || isProcessing) {
        speechStartRef.current = null;
        silenceStartRef.current = null;
        return;
      }

      if (!recorderRef.current) {
        if (rms > VAD_CONFIG.SPEECH_THRESHOLD) {
          if (!speechStartRef.current) speechStartRef.current = now;
          if (now - speechStartRef.current >= VAD_CONFIG.SPEECH_START_MS) {
            startRecording();
            silenceStartRef.current = null;
          }
        } else {
          speechStartRef.current = null;
        }
        return;
      }

      if (rms < VAD_CONFIG.SILENCE_THRESHOLD) {
        if (!silenceStartRef.current) silenceStartRef.current = now;
        if (now - silenceStartRef.current >= VAD_CONFIG.SILENCE_DURATION_MS) {
          stopRecording();
          speechStartRef.current = null;
          silenceStartRef.current = null;
        }
      } else {
        silenceStartRef.current = null;
      }
    }, VAD_CONFIG.VAD_INTERVAL_MS);

    setIsListening(true);
  }, [getRms, isProcessing, startRecording, stopRecording]);

  useEffect(() => stopListening, [stopListening]);

  return {
    isListening,
    isRecording,
    isProcessing,
    audioLevel,
    startListening,
    stopListening,
  };
}
