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
- **🔑 Digital Key Card** — Generates an Apple Wallet pass (`.pkpass`) on check-in completion and emails it to the guest. The pass includes room details, QR barcode, and hotel branding — guests can add it to Apple Wallet directly from the email. Modular wallet service architecture supports future Google Wallet integration.
- **📧 Check-in Confirmation Email** — Sends a styled HTML email to the guest with room details, stay dates, and the wallet pass attached.
- **💬 Post Check-in Conversation** — After check-in completes, the AI continues chatting as a personal concierge — sharing local tips, answering hotel questions, and making the guest feel welcome.
- **📷 Real Passport Scanner** — Camera-based passport OCR (EasyOCR + Tesseract MRZ pipeline) with automatic field extraction. Falls back to mock data or manual entry when hardware is unavailable.
- **💳 NFC Card Reader** — ESP32 + PN532 contactless card reader for demo payments. AES-128-CBC encrypted communication. Falls back to on-screen tap simulation when hardware is unavailable.
- **📊 Hotel Data Backend** — In-memory mock data with Supabase support for production

---

## 📁 Project Structure

```
ai-checkin-robot/
├── frontend/                  # React + Vite + Tailwind CSS
│   └── src/
│       ├── components/        # UI components (avatar, checkin, conversation, ui)
│       ├── hooks/             # useAvatar, useVoiceInput (VAD), useVoiceOutput, useCheckin
│       ├── stores/            # Zustand state (conversation, checkin, avatar)
│       └── services/          # API client, Socket.IO
├── backend/                   # Express + Socket.IO + TypeScript
│   ├── src/
│   │   ├── routes/            # REST endpoints (chat, voice, hotel, checkin, avatar)
│   │   ├── services/          # AI (with tool use), TTS, STT, avatar, hotel data
│   │   ├── utils/             # NFC crypto (AES-128-CBC)
│   │   ├── prompts/           # System prompts for the AI concierge
│   │   └── config/            # Environment config
│   ├── scripts/               # Python bridge scripts (passport scanner)
│   └── certs/                 # Apple Wallet certificates — gitignored
├── camera-and-nfc/            # Hardware integration (passport OCR + NFC reader)
│   └── Identification-and-payment-app/
│       ├── core/              # Scanner (EasyOCR + Tesseract MRZ), validator, data model
│       └── network/           # NFC serial/HTTP listener, ESP32 WiFi, Supabase transmitter
├── scripts/                   # Setup scripts
├── supabase/                  # DB schema & seed data
└── .env.example               # Environment variable template
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18 (recommended: 20+)
- **npm** ≥ 9
- **Python 3.8+** (only needed for live passport scanner mode)
- API keys (see below)

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/ai-checkin-robot.git
cd ai-checkin-robot
```

### 2. Install dependencies

**Option A: Quick setup (installs both Node.js and Python deps)**
```bash
./scripts/setup.sh
```

**Option B: Node.js only (default mock mode, no hardware)**
```bash
npm install
```

**Option C: Add Python deps later (for live hardware mode)**
```bash
npm install
pip install -r camera-and-nfc/Identification-and-payment-app/requirements.txt
```

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
| `APPLE_PASS_TYPE_ID` | For digital key | Apple Pass Type Identifier (e.g. `pass.com.yourco.hotel`) |
| `APPLE_TEAM_ID` | For digital key | Apple Developer Team ID |
| `APPLE_PASS_P12_PATH` | For digital key | Path to your `.p12` certificate file |
| `APPLE_PASS_P12_PASSWORD` | For digital key | Password for the `.p12` file |
| `APPLE_WWDR_CERT_PATH` | For digital key | Path to Apple WWDR G4 certificate (PEM format) |
| `SMTP_HOST` | For email | SMTP server host (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | For email | SMTP port (default: `587`) |
| `SMTP_USER` | For email | SMTP username / email address |
| `SMTP_PASS` | For email | SMTP password (Gmail: use an [App Password](https://myaccount.google.com/apppasswords)) |
| `SMTP_FROM` | For email | Sender name and address for emails |
| `PASSPORT_SCANNER_MODE` | Optional | `mock` (default) or `live` for real camera OCR |
| `NFC_SHARED_SECRET_KEY` | For NFC | 16-char AES key shared with ESP32 |
| `ESP32_WIFI_START_URL` | For NFC | ESP32 HTTP endpoint (e.g. `http://192.168.1.100/start`) |

> **Note:** Variables prefixed with `VITE_` are exposed to the frontend. The Simli avatar runs entirely in the browser via WebRTC, so it needs client-side API access.
>
> The digital key card and email features degrade gracefully — if Apple Wallet or SMTP credentials are not set, those features are simply skipped and a warning is logged at startup.

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
| `./scripts/setup.sh` | Install all dependencies (Node.js + Python) |
| `./scripts/setup.sh --python` | Install only Python deps (for live hardware) |

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

### Apple Wallet Digital Key Card (Optional)
Generates a `.pkpass` file that guests can add to Apple Wallet. Requires an Apple Developer account.

1. Create a **Pass Type ID** in your [Apple Developer account](https://developer.apple.com/account/resources/identifiers/list/passTypeId) (e.g. `pass.com.yourcompany.hotel`)
2. Generate and download a certificate for that Pass Type ID, then export it as a `.p12` file from Keychain Access
3. Download the [Apple WWDR G4 certificate](https://www.apple.com/certificateauthority/) and convert to PEM:
   ```bash
   openssl x509 -inform DER -in AppleWWDRCAG4.cer -out AppleWWDRCAG4.pem
   ```
4. Place both files in `backend/certs/` (this directory is gitignored)
5. Set `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_PASS_P12_PATH`, `APPLE_PASS_P12_PASSWORD`, and `APPLE_WWDR_CERT_PATH` in `.env`

> **Tip:** You can add custom pass images (icon, logo) to `backend/src/services/wallet/pass-assets/`. Required sizes: `icon.png` (29x29), `icon@2x.png` (58x58), `logo.png` (160x50), `logo@2x.png` (320x100). Placeholder images are used if none are provided.

### Email Notifications (Optional)
Sends a branded check-in confirmation email with the wallet pass attached.

1. For **Gmail**: enable 2-Step Verification, then generate an [App Password](https://myaccount.google.com/apppasswords)
2. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in `.env`

---

## 📷 Live Hardware Mode

By default the app runs in **mock mode** — no camera, NFC reader, or ESP32 needed. To enable real hardware for demos:

### Passport Scanner (Camera + OCR)

**What it does:** The backend spawns a Python subprocess that captures a frame from the connected camera, runs a two-pass MRZ OCR pipeline (EasyOCR + Tesseract), and extracts the passport number and guest name.

**Setup:**

1. Install Python dependencies (if you haven't already):
   ```bash
   pip install -r camera-and-nfc/Identification-and-payment-app/requirements.txt
   ```
2. Connect a USB camera to the machine (or use the built-in webcam)
3. Set in `.env`:
   ```
   PASSPORT_SCANNER_MODE=live
   ```
4. (Optional) If using a specific camera, set `CAMERA_INDEX=1` (or 2, etc.) in `camera-and-nfc/Identification-and-payment-app/.env`

**How it works at runtime:**
- When the AI advances to the passport scan step, the scan starts automatically -- no button tap required
- The UI shows a scanning overlay with a progress animation and an "Enter Manually Instead" bypass button
- Backend spawns `python3 backend/scripts/scan_passport.py`
- The script opens the camera, shows an alignment box on the backend machine's display, captures frames, and runs OCR
- Returns JSON `{passport_id, guest_name, passport_image_base64}` to the backend
- Backend looks up the reservation by passport number and advances the flow
- If the scan fails or times out (60s default), the overlay shows a "Try Again" button and the **"Enter Manually"** bypass to type a name or confirmation code instead

**Things to note:**
- First run takes longer (~10-20s) because EasyOCR loads its models into memory. Subsequent scans are faster.
- The EasyOCR model files (`craft_mlt_25k.pth`, `english_g2.pth`) are ~100MB total. Run `python3 camera-and-nfc/Identification-and-payment-app/download_easyocr_models.py` to pre-download them.
- On Jetson, OpenCV and numpy are usually pre-installed via JetPack.
- The camera preview (OpenCV `imshow` window) will appear on the machine running the backend, not in the browser. For a kiosk setup, the machine display shows the camera feed while the browser shows the UI.

### NFC Card Reader (ESP32 + PN532)

**What it does:** When the guest reaches the payment step, the backend sends an encrypted "ACTIVATE" command to the ESP32 over WiFi. The ESP32 starts its PN532 NFC reader and waits for a card tap. When tapped, it sends the encrypted card UID back to the backend. The frontend polls for the result and auto-advances.

**Setup:**

1. Flash the ESP32 with the NFC firmware (in `camera-and-nfc/Identification-and-payment-app/arduinofile.cpp`)
2. Connect the PN532 NFC reader to the ESP32 (I2C: SDA=21, SCL=22)
3. Put the ESP32 on the same WiFi network as the machine running the backend
4. Set in `.env`:
   ```
   NFC_SHARED_SECRET_KEY=your16charkey!!
   ESP32_WIFI_START_URL=http://192.168.x.x/start
   ```
   - `NFC_SHARED_SECRET_KEY` must be exactly 16 characters and must match what's in the ESP32 firmware
   - `ESP32_WIFI_START_URL` is the ESP32's IP on your network followed by `/start`

5. **Important:** The ESP32 needs to know where to send the NFC UID back. In the ESP32 firmware, set the callback URL to point at your backend:
   ```
   http://<your-backend-ip>:3001/api/checkin/nfc-uid
   ```

**How it works at runtime:**
- Guest reaches the payment screen
- Frontend calls `POST /api/checkin/activate-nfc` which sends encrypted "ACTIVATE" to ESP32
- ESP32 turns on the NFC reader and its LED
- Guest taps their NFC card
- ESP32 reads the UID, encrypts it, and POSTs to `POST /api/checkin/nfc-uid`
- Backend decrypts and stores the UID, maps it to a card last-4 via `NFC_UID_TO_LAST4`
- Frontend polls `GET /api/checkin/nfc-status` every 1.5s and auto-advances when detected
- If the ESP32 is unreachable or NFC fails, the guest can tap **"Skip — Pay Without Card Reader"** to proceed with simulated payment

**Things to note:**
- The NFC UID-to-card mapping is configured via `NFC_UID_TO_LAST4` in `.env` (default: `{"09C9C802":"5264"}`). Add your NFC card UIDs to this map.
- All communication between backend and ESP32 is AES-128-CBC encrypted with a shared key.
- The backend stores received UIDs in memory — they expire after 30 seconds.

### Bypass Buttons

Both hardware steps have UI bypass buttons that are always visible:
- **Passport scan:** "Enter Manually Instead" button skips to the chat-based identification flow (visible during scanning and on failure)
- **Payment:** "Skip — Pay Without Card Reader" button proceeds with simulated payment

This ensures the demo never gets stuck if hardware isn't connected or malfunctions.

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
│  │  └── Function Calling ──┐  │ │     │
│  │                          │  │ │     │
│  └──────────────────────────┘ │     │
│               ▼                  │     │
│  ┌─────┐  ┌─────┐  ┌─────────┐ │     │
│  │Hotel│  │ TTS │  │   STT   │ │     │
│  │Svc  │  │     │  │ Whisper │ │     │
│  └──┬──┘  └──┬──┘  └─────────┘ │     │
│     │        └─────────────────►┼─────┘
│     ▼                           │
│  ┌────────────────────────────┐ │
│  │ Hotel Data (mock/Supabase) │ │
│  └────────────────────────────┘ │
│                                   │
│  Hardware Integration:            │
│  ┌──────────────┐  ┌───────────┐ │    ┌──────────┐
│  │ Passport Scan│  │ NFC Crypto│◄┼────│  ESP32   │
│  │ (Python OCR) │  │ (AES-CBC) │ │    │ + PN532  │
│  └──────────────┘  └───────────┘ │    └──────────┘
│                                   │
│  On check-in complete:            │
│  ┌──────────┐  ┌───────────────┐ │
│  │  Wallet  │──│    Email      │──► Guest inbox
│  │  (.pkpass)│  │ (Nodemailer) │ │
│  └──────────┘  └───────────────┘ │
└───────────────────────────────────┘
```

---

## 👥 Team

School project — re-imagining the hotel check-in experience.

---

## 📝 License

This project is for educational purposes.
