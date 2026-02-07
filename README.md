# 🏨 AI Hotel Check-in Kiosk

> Re-imagining the hotel check-in experience with AI-powered conversational assistants, talking-head avatars, and holographic displays.

A full-stack kiosk application featuring a **voice-interactive AI concierge** that guides guests through hotel check-in. Built for deployment on an **Nvidia Jetson** with touchscreen, speakers, and microphone — but fully runnable on any laptop for development.

![Tech Stack](https://img.shields.io/badge/React-19-blue) ![Tech Stack](https://img.shields.io/badge/TypeScript-5.9-blue) ![Tech Stack](https://img.shields.io/badge/Node.js-Express-green) ![Tech Stack](https://img.shields.io/badge/Vite-7-purple)

---

## ✨ Features

- **🤖 AI Concierge** — Powered by OpenAI GPT-4 (or Gemini fallback), with full hotel context
- **🎭 Talking-Head Avatar** — Real-time lip-synced avatar via [Simli](https://simli.com) WebRTC SDK
- **🗣️ Voice Interaction** — Speech-to-text (Whisper) + text-to-speech (OpenAI TTS) pipeline
- **🌀 Holographic UI** — Animated hologram effects on the avatar display
- **📋 Check-in Wizard** — Step-by-step flow: Welcome → Passport → Reservation → Room Selection → Payment → Key Card
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
│   │   ├── hooks/           # useAvatar, useVoiceInput, useVoiceOutput, useCheckin
│   │   ├── stores/          # Zustand state (conversation, checkin, avatar)
│   │   ├── services/        # API client, Socket.IO, Supabase
│   │   └── utils/           # Audio processing, hologram effects
│   └── vite.config.ts
├── backend/                 # Express + Socket.IO + TypeScript
│   └── src/
│       ├── routes/          # REST endpoints (chat, voice, hotel, checkin, avatar)
│       ├── services/        # AI, TTS, STT, avatar, hotel data
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
2. **Type or tap the mic** to talk to the AI concierge
3. **Follow the check-in wizard** — the AI will guide you through passport scanning, room selection, and payment
4. **The avatar** lip-syncs to the AI's spoken responses in real-time

### Voice Interaction

- Click the **microphone button** to start recording
- Click again to **stop** — your speech is transcribed and sent to the AI
- The AI responds with **text + voice**, and the avatar animates in sync

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
│  │  Panel  │  │  Button  │  │   (WebRTC SDK)    │    │
│  └────┬────┘  └────┬─────┘  └─────────▲─────────┘    │
│       │             │                  │ PCM16 audio   │
│       │   REST/WS   │                  │               │
└───────┼─────────────┼──────────────────┼──────────────┘
        │             │                  │
        ▼             ▼                  │
┌───────────────────────────────────┐    │
│         Backend (Express)         │    │
│                                   │    │
│  ┌─────┐  ┌─────┐  ┌─────────┐  │    │
│  │ GPT │  │ TTS │  │   STT   │  │    │
│  │ -4  │  │     │  │ Whisper │  │    │
│  └─────┘  └──┬──┘  └─────────┘  │    │
│              │ MP3                │    │
│              └───────────────────►┼────┘
│                                   │ (decoded to PCM16
│  ┌────────────────────────────┐  │  on frontend)
│  │   Hotel Data (in-memory    │  │
│  │   or Supabase)             │  │
│  └────────────────────────────┘  │
└───────────────────────────────────┘
```

---

## 👥 Team

School project — re-imagining the hotel check-in experience.

---

## 📝 License

This project is for educational purposes.
