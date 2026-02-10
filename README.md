# 🏨 AI Hotel Check-in Kiosk

> Re-imagining the hotel check-in experience with AI-powered conversational assistants, talking-head avatars, and holographic displays.

A full-stack kiosk application featuring a **voice-interactive AI concierge** that guides guests through hotel check-in. Built for deployment on an **Nvidia Jetson** with touchscreen, speakers, and microphone — but fully runnable on any laptop for development.

![Tech Stack](https://img.shields.io/badge/React-19-blue) ![Tech Stack](https://img.shields.io/badge/TypeScript-5.9-blue) ![Tech Stack](https://img.shields.io/badge/Node.js-Express-green) ![Tech Stack](https://img.shields.io/badge/Vite-7-purple)

---

## ✨ Features

- **🤖 AI Concierge with Tool Use** — Powered by OpenAI GPT-4 (or Gemini fallback) with function calling. The AI queries real hotel data, looks up reservations, and triggers UI actions — never fabricates information.
- **🎭 Talking-Head Avatar** — Real-time lip-synced avatar via [Simli](https://simli.com) WebRTC SDK
- **🗣️ Hands-Free Voice Mode** — Voice Activity Detection (VAD) keeps the mic open and auto-detects speech. No button presses needed — just speak naturally, like ChatGPT voice mode.
- **🌀 Holographic UI** — Animated hologram effects on the avatar display
- **📋 AI-Driven Check-in Flow** — The AI avatar drives every screen transition: Welcome → Identify → Passport Scan → Reservation Confirm → Room Selection → Upgrades → Payment → Key Card. Guests confirm each step via voice or button — the AI acknowledges naturally and advances the UI.
- **💬 Post Check-in Conversation** — After check-in completes, the AI continues chatting as a personal concierge — sharing local tips, answering hotel questions, and making the guest feel welcome.
- **🔌 Mock Hardware** — Simulated passport scanner & credit card reader (swappable for real hardware on Jetson)
- **📊 Hotel Data Backend** — In-memory mock data with Supabase support for production

---

## 📁 Project Structure

```
ai-checkin-robot/
├── frontend/                # React + Vite + Tailwind CSS
│   ├── src/
│   │   ├── components/      # UI components
│   │   │   ├── avatar/      # AvatarDisplay, HologramOverlay
│   │   │   ├── checkin/     # Wizard screens (Welcome, Passport, Room, etc.)
│   │   │   ├── conversation/# ChatPanel, VoiceButton, TranscriptDisplay
│   │   │   ├── hardware/    # MockPassportScanner, MockCardReader
│   │   │   └── ui/          # Shared UI components
│   │   ├── hooks/           # useAvatar, useVoiceInput (VAD), useVoiceOutput, useCheckin
│   │   ├── stores/          # Zustand state (conversation, checkin, avatar)
│   │   ├── services/        # API client, Socket.IO, Supabase
│   │   └── utils/           # Audio processing, hologram effects
│   └── vite.config.ts
├── backend/                 # Express + Socket.IO + TypeScript
│   └── src/
│       ├── routes/          # REST endpoints (chat, voice, hotel, checkin, avatar)
│       ├── services/        # AI (with tool use), TTS, STT, avatar, hotel data
│       ├── prompts/         # System prompts for the AI concierge
│       ├── config/          # Environment config
│       └── socket.ts        # Real-time voice pipeline via WebSocket
├── hardware/                # Jetson-specific config
├── supabase/                # DB schema & seed data
├── docker-compose.yml       # Local Docker setup
├── docker-compose.jetson.yml# Jetson deployment
└── .env.example             # Environment variable template
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18 (recommended: 20+)
- **npm** ≥ 9
- API keys (see below)

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/ai-checkin-robot.git
cd ai-checkin-robot
```

### 2. Install dependencies

```bash
npm install
```

This installs dependencies for the root, `frontend/`, and `backend/` workspaces automatically (npm workspaces).

### 3. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your API keys:

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | Powers AI chat (GPT-4), TTS, and STT (Whisper) |
| `VITE_SIMLI_API_KEY` | For avatar | Simli API key ([get one here](https://simli.com)) |
| `VITE_SIMLI_FACE_ID` | For avatar | Simli face ID for the avatar character |
| `GEMINI_API_KEY` | Optional | Google Gemini as fallback LLM |
| `SUPABASE_URL` | Optional | Supabase project URL (uses in-memory data if unset) |
| `SUPABASE_ANON_KEY` | Optional | Supabase anon key |

> **Note:** Variables prefixed with `VITE_` are exposed to the frontend. The Simli avatar runs entirely in the browser via WebRTC, so it needs client-side API access.

### 4. Run the dev server

```bash
npm run dev
```

This starts **both** the backend (port 3001) and frontend (port 5173) concurrently.

Open **http://localhost:5173** in your browser.

---

## 🎮 How to Use

1. **Open the app** in your browser — you'll see the check-in kiosk with the AI avatar
2. **Tap the mic button** to enter hands-free voice mode, or type in the chat box
3. **Just speak naturally** — the AI detects when you start and stop talking automatically
4. **Follow the check-in flow** — the AI drives the entire process. It advances screens after you confirm each step (via voice or on-screen buttons). You can still tap to select rooms and upgrades — the AI picks up your choices and responds accordingly.
5. **Keep chatting after check-in** — the AI stays as your personal concierge, happy to answer questions and share recommendations

### Voice Mode (VAD)

The voice system uses **Voice Activity Detection** for a natural, hands-free experience:

- Tap the **microphone button once** to enter listening mode (cyan pulse)
- **Just speak** — the system detects speech onset automatically (red pulse while recording)
- **Pause naturally** — it waits for ~1.5s of silence before processing, so mid-sentence pauses are fine
- Your speech is transcribed (Whisper) and sent to the AI
- **While the AI is speaking**, detection pauses automatically to prevent echo
- Tap the mic again to **exit** listening mode

> No audio is streamed or sent to any API while you're silent — the VAD runs entirely locally via the Web Audio API. The only API call is the Whisper transcription when you finish an utterance.

---

## 🧠 AI Concierge — How It Works

The AI concierge ("Azure") uses **OpenAI function calling** (tool use) to interact with real data and control the kiosk UI. It never fabricates hotel information.

### Available AI Tools

| Tool | Type | Description |
|---|---|---|
| `lookup_reservation_by_name` | Data | Find reservation by guest's first + last name |
| `lookup_reservation` | Data | Find reservation by confirmation code |
| `lookup_reservation_by_passport` | Data | Find reservation by passport number |
| `get_hotel_info` | Data | Hotel amenities, Wi-Fi, breakfast, nearby attractions |
| `get_available_rooms` | Data | List available rooms with prices |
| `get_room_upgrades` | Data | Upgrade options for a given room type |
| `set_checkin_step` | UI | Update the progress bar step |
| `trigger_passport_scan` | UI | Show the passport scanner screen |
| `trigger_payment` | UI | Show the payment screen |
| `dispense_key_card` | UI | Show the key card dispensing screen |
| `store_reservation` | State | Persist reservation + guest data in frontend store |

### AI-Driven Flow Transitions

The AI controls all screen transitions during check-in. When a guest confirms a step — either by speaking ("Yes, that's my reservation") or tapping a button on-screen — the confirmation is sent as a chat message to the AI. The AI responds naturally, then uses `set_checkin_step` to advance the kiosk UI. This keeps the avatar's conversation and the on-screen flow perfectly in sync.

Interactive elements (room cards, upgrade cards) remain fully clickable. The guest's selections are included in the AI context (`selectedRoom`, `selectedUpgrade`), so the AI always knows what was picked and can reference it in conversation.

### Context Persistence

The frontend sends the current check-in state (step, reservation, guest, selected room, selected upgrade) with every message. Once the AI finds a reservation, a `store_reservation` action saves it to the frontend's Zustand store, so the AI always has access to the guest's details throughout the entire conversation — even after check-in completes.

### Post Check-in

After the key card is dispensed, the AI **continues the conversation** as a personal concierge — asking about the guest's trip, sharing restaurant recommendations, local tips, and more. The check-in wizard UI clears away and the avatar stays on screen.

---

## 🛠️ Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start both frontend + backend in dev mode |
| `npm run dev:frontend` | Start only the frontend |
| `npm run dev:backend` | Start only the backend |
| `npm run build` | Build both for production |
| `npm run lint` | Lint both workspaces |

---

## 🔑 API Keys Setup

### OpenAI (Required)
1. Go to [platform.openai.com](https://platform.openai.com)
2. Create an API key
3. Set `OPENAI_API_KEY` in `.env`

### Simli Avatar (Optional but recommended)
1. Go to [simli.com](https://simli.com) and sign up
2. Get your API key from the dashboard
3. Choose a face ID from their face library
4. Set `VITE_SIMLI_API_KEY` and `VITE_SIMLI_FACE_ID` in `.env`

> Without Simli keys, the app runs in **voice-only mode** with a placeholder avatar.

### Supabase (Optional)
The app uses **in-memory mock data** by default — no database needed for development. To use Supabase:
1. Create a project at [supabase.com](https://supabase.com)
2. Run the migration: `supabase/migrations/001_initial_schema.sql`
3. Seed data: `supabase/seed.sql`
4. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Frontend (React)                    │
│                                                        │
│  ┌─────────┐  ┌──────────┐  ┌───────────────────┐    │
│  │  Chat   │  │  Voice   │  │   Simli Avatar    │    │
│  │  Panel  │  │  (VAD)   │  │   (WebRTC SDK)    │    │
│  └────┬────┘  └────┬─────┘  └─────────▲─────────┘    │
│       │             │                  │ PCM16 audio   │
│       │   REST/WS   │                  │               │
│  ┌────┴─────────────┴──┐               │               │
│  │  Zustand Stores     │               │               │
│  │  (checkin, convo)   │               │               │
│  └─────────────────────┘               │               │
└───────┼─────────────────────────────────┼──────────────┘
        │                                 │
        ▼                                 │
┌───────────────────────────────────┐     │
│         Backend (Express)         │     │
│                                   │     │
│  ┌─────────────────────────────┐ │     │
│  │  AI Service (GPT-4)         │ │     │
│  │  ┌─────────────────────┐   │ │     │
│  │  │  Function Calling   │   │ │     │
│  │  │  (tool use)         │   │ │     │
│  │  └─────────┬───────────┘   │ │     │
│  └────────────┼───────────────┘ │     │
│               ▼                  │     │
│  ┌─────┐  ┌─────┐  ┌─────────┐ │     │
│  │Hotel│  │ TTS │  │   STT   │ │     │
│  │Svc  │  │     │  │ Whisper │ │     │
│  └──┬──┘  └──┬──┘  └─────────┘ │     │
│     │        │ MP3              │     │
│     │        └─────────────────►┼─────┘
│     │                           │ (decoded to PCM16
│     ▼                           │  on frontend)
│  ┌────────────────────────────┐ │
│  │   Hotel Data (in-memory   │ │
│  │   mock or Supabase)       │ │
│  └────────────────────────────┘ │
└───────────────────────────────────┘
```

---

## 👥 Team

School project — re-imagining the hotel check-in experience.

---

## 📝 License

This project is for educational purposes.
