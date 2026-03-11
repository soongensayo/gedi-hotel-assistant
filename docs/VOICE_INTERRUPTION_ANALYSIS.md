# Voice Interruption (Barge-In) — Analysis & Implementation Plan

## Goal

Enable **ChatGPT-style interruptible voice**: when the AI is speaking, the user can interrupt mid-sentence by starting to talk. The AI stops immediately, the user's speech is captured, transcribed, and processed as a new message.

---

## Current Architecture

### Voice Input (`useVoiceInput.ts`)

- **VAD (Voice Activity Detection)** via Web Audio API `AnalyserNode` — ~20×/sec RMS sampling
- When sustained speech above threshold → starts `MediaRecorder` segment
- When sustained silence (~1s) → stops recorder, sends blob to Whisper API for transcription
- **Critical behavior**: VAD is **paused** when `isSpeaking || isLoading || isProcessing`:

```205:224:frontend/src/hooks/useVoiceInput.ts
        // ── Pause detection when AI is active ───────────────────────
        const { isSpeaking, isLoading } = useConversationStore.getState();
        if (isSpeaking || isLoading || isProcessingRef.current) {
          // ... discards any in-flight recording, clears state
          return;
        }
```

- **Why it pauses**: To avoid echo — the mic would pick up the AI's voice from speakers and transcribe it as "user speech"

### Voice Output (`useVoiceOutput.ts`)

- Splits reply into sentences, fires TTS in parallel, streams PCM to Simli in order
- Fallback: plays through `<audio>` when avatar disconnected
- Has `stop()` which:
  - Pauses local `Audio` element
  - Calls `client.ClearBuffer()` for Simli avatar
  - Sets `isSpeaking` to false in store

### Conversation Flow (`ChatPanel.tsx`)

1. User speaks → VAD captures → transcribe → `handleSendMessage`
2. `handleSendMessage`: add user msg, set loading, call API, add assistant msg, `speak(reply)`, process actions
3. Sequential: no overlap between user input and AI output

---

## Main Challenges

### 1. Echo (Acoustic Feedback)

**Problem**: When AI speaks through speakers, the microphone picks it up. If we listen during `isSpeaking`, VAD will trigger on the AI's voice and treat it as user speech → feedback loop.

**Current mitigation**: Pause VAD while AI speaks. That prevents interruption entirely.

**Options**:

| Approach | Pros | Cons |
|----------|------|------|
| **A. Rely on browser echo cancellation** | Already enabled (`echoCancellation: true`). No extra work. | May not be enough if speakers are loud or far from mic. In hotel kiosks, speakers and mic are often close. |
| **B. Higher threshold during AI speech** | User has to speak louder/closer to interrupt. Simpler. | Less natural; may miss soft interruptions. |
| **C. Reference-based echo cancellation** | Play reference signal, subtract from mic. High quality. | Complex; need access to playback stream and sample-accurate sync. |
| **D. Tap-to-interrupt** | User taps mic to interrupt, then speaks. No echo issue. | Less natural than voice-triggered barge-in. |
| **E. Use realtime/duplex API** | Some STT APIs support "barge-in" with built-in echo handling. | Your stack uses Whisper (batch) + VAD; would need architecture shift. |

**Recommendation for hotel kiosk**: Start with **A + B**:
- Keep `echoCancellation` on
- When `isSpeaking`, use a **higher speech threshold** (e.g. 2× normal) so only clear, close user speech triggers interruption
- Optionally add a **short grace period** (e.g. 200ms) before treating speech as an interruption, to avoid accidental triggers from AI voice bleed

### 2. Making `speak()` Interruptible

**Problem**: `useVoiceOutput.speak()` is async. It:
1. Fires N TTS requests in parallel
2. Awaits them **in order** and sends PCM to Simli one by one
3. Uses `setTimeout` to guess when playback ends

If the user interrupts mid-way:
- We need to **stop** immediately — `stop()` already does this
- We must **cancel** the in-flight `speak()` so it doesn't keep sending more audio or reset `isSpeaking` after our `stop()` call

**Solution**: Use an `AbortSignal` / "speak session" ID. When `stop()` is called:
1. Abort the current speak session
2. In `speak()`, check abort before each sentence send; if aborted, exit early without resetting state (since `stop()` already did)

### 3. In-Flight AI Request During Interruption

**Problem**: User interrupts while `isLoading` (waiting for `sendChatMessage`). Two flows:
- **Interrupt during AI response generation**: Cancel the fetch (AbortController) and ignore the reply when it arrives
- **Interrupt during TTS playback**: We handle this with `stop()` — no AI request to cancel

**Solution**: Add `AbortController` to `sendChatMessage` and `handleSendMessage`. When interruption is detected, abort the controller. The fetch will be cancelled; if it already completed, ignore the result.

### 4. Race Conditions

**Problem**: Interruption triggers → we call `stop()` and start capturing. But `stop()` sets `isSpeaking = false`. The VAD loop will then see `!isSpeaking` and start normal detection. We need to ensure:
- We don't double-process (e.g. both "interrupt" and "new utterance" handlers firing)
- `isProcessing` from a previous transcribe doesn't block the new interrupt flow

**Solution**: Introduce an explicit `interruptRequested` or `interruptInProgress` state. When user speech is detected during `isSpeaking`, set it, call `stop()`, then let VAD treat the rest as a normal utterance. Clear the flag when we're done.

---

## Recommended Implementation Path

### Phase 1: Core Interruption Wiring ✅ IMPLEMENTED

1. **Add `onInterrupt` callback to `useVoiceInput`**
   - When `isSpeaking` and VAD detects speech (with current thresholds), call `onInterrupt` instead of pausing
   - `onInterrupt` receives nothing (just a signal)
2. **Wire `onInterrupt` in ChatPanel**
   - Call `stop()` from `useVoiceOutput`
3. **Make `speak()` abortable**
   - Pass `AbortSignal` or use a ref/counter. When `stop()` is called, abort the speak session.
4. **Result**: Interruption works only when we **don't** pause VAD during `isSpeaking`. So we need to change the pause logic.

### Phase 2: Echo Mitigation

5. **Adjust VAD during AI speech**
   - When `isSpeaking`: use `SPEECH_THRESHOLD * 2` (or configurable multiplier)
   - Optionally require slightly longer sustained speech (e.g. 150ms instead of 100ms) before treating as interrupt
6. **Test in real kiosk setup** — speakers, mic position, ambient noise
7. **Fallback**: If false triggers persist, add tap-to-interrupt as alternative (user taps mic → we call `stop()` and start "recording for interrupt" mode with normal thresholds)

### Phase 3: Cancel In-Flight Requests

8. **AbortController for `handleSendMessage`**
   - Create AbortController per send
   - Pass signal to axios/fetch
   - On interrupt, abort and ignore result
9. **AbortController for `speak()`**
   - Already covered in Phase 1

---

## Code Changes Summary

### `useVoiceInput.ts`

- Add optional `onInterrupt?: () => void` (or keep `onTranscript` and add `onInterrupt`)
- **Change pause logic**: When `isSpeaking`:
  - Do NOT pause entirely
  - Use higher threshold and optional longer speech-start
  - When speech detected → call `onInterrupt()`, then **discard current segment** and let the next silence→speech cycle start a fresh recording (OR: keep recording from this point and treat it as the new utterance)
- Simpler variant: when `isSpeaking` and speech detected → call `onInterrupt()`, set a flag `interruptTriggered`, stop any current recording, reset. On next speech onset (after `isSpeaking` becomes false), normal VAD continues. But we need the speech that triggered the interrupt to be captured! So:
  - **Better approach**: When `isSpeaking` and speech detected → call `onInterrupt()` (which calls `stop()`), DON'T discard. Continue recording. When silence, transcribe as usual. So we need to NOT return early when `isSpeaking` — we need to stay in the state machine but with modified thresholds, and when we detect speech we first fire `onInterrupt()`.

### `useVoiceOutput.ts`

- Add `AbortSignal` support to `speak()`
- Return or expose a way to abort: e.g. `speak(text, signal?: AbortSignal)` 
- Store `abortControllerRef` for the current speak session
- In `stop()`, abort that controller
- In `speak()`, check `signal?.aborted` before sending each sentence; if aborted, exit without setting `isSpeaking` (stop already did)

### `ChatPanel.tsx`

- Get `stop` from `useVoiceOutput`
- Pass `onInterrupt: stop` to `useVoiceInput` (via VoiceButton)
- When calling `speak()`, pass an AbortController's signal; store the controller so we can abort on interrupt

### `VoiceButton.tsx`

- Accept `onInterrupt?: () => void`
- Pass it to `useVoiceInput`

### `api.ts`

- Add optional `signal?: AbortSignal` to `sendChatMessage`; pass to axios

---

## Testing Checklist

- [ ] User speaks → AI responds → user interrupts mid-sentence → AI stops, user's new speech is captured and processed
- [ ] No feedback loop when AI speaks (mic doesn't trigger on speaker output)
- [ ] Interrupt during `isLoading` (AI thinking) → in-flight request is aborted, no stale reply spoken
- [ ] Rapid interrupt (user interrupts, starts speaking, interrupts again) → no double-processing
- [ ] Avatar (Simli) path: `ClearBuffer()` stops lip-sync promptly
- [ ] Fallback (no avatar): `Audio.pause()` stops promptly

---

## Optional Enhancements

1. **Visual feedback**: When user interrupts, briefly show "Interrupted" or pulse the mic red
2. **Tap-to-interrupt**: Add explicit button or mic-tap to force stop without speaking (useful if voice trigger is unreliable)
3. **Configurable thresholds**: Expose `INTERRUPT_SPEECH_THRESHOLD_MULTIPLIER` in env or settings for different room acoustics
