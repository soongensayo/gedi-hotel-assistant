# PrimeDrive — Stanford showcase (in-car tablet)

## Quick start

```bash
# From repo root
npm run dev        # backend + stanford (default)
npm run dev:backend
npm run dev:stanford
npm run dev:nus    # backend + original NUS kiosk (port 5173)
```

For lab debugging, prefer the split backend/frontend commands in separate terminals so backend, Supabase, and Vite logs are easier to read.

- **Guest tablet:** http://localhost:5174/
- **Concierge panel:** http://localhost:5174/staff

## Multi-device demo

The Vite dev server binds to `0.0.0.0` so any device on the same network can reach it. Backend CORS is permissive in dev mode.

1. Find your machine's LAN IP (`ipconfig getifaddr en0` on macOS, or `hostname -I` on Linux).
2. On the **guest tablet**: open `http://<LAN_IP>:5174/`
3. On the **staff laptop**: open `http://<LAN_IP>:5174/staff` (or just `localhost:5174/staff` if it's the same machine)
4. Both devices share the same Jitsi room and Socket.IO room — concierge actions appear on the guest tablet in real time.

> Camera, microphone, and camera-based passport scanning require HTTPS on non-localhost origins. A LAN URL like `http://192.168.x.x:5174/staff` can still show the app, but the browser may block WebRTC.

### LAN HTTPS demo

Your usual three-terminal demo runbook can stay the same, except the Stanford frontend should run over HTTPS:

1. Once on the interface machine, generate a local cert:

   ```bash
   npm run setup:stanford-https
   ```

   If the detected IP is wrong, pass the exact interface-machine IP:

   ```bash
   npm run setup:stanford-https -- 192.168.x.x
   ```

2. Start the demo:
   - Terminal 1: encoder Python service
   - Terminal 2: `npm run dev:backend`
   - Terminal 3: `npm run dev:stanford:https`

3. Open the guest machine at `https://<LAN_IP>:5174/`.

4. Open the staff laptop at `https://<LAN_IP>:5174/staff`.

Because this uses a self-signed local certificate, each browser must accept/trust the certificate once. For a polished showcase, use a trusted local certificate or an HTTPS tunnel such as ngrok.

## Env (optional, in repo root `.env`)

| Variable | Purpose |
|----------|---------|
| `VITE_STANFORD_ROOM_ID` | Shared session id for Socket.IO + Jitsi room suffix (default: `prime-demo`) |
| `VITE_STANFORD_USE_NFC` | Set `true` to use the hardware card encoder/dispenser during the key-card step |
| `STANFORD_ENCODER_URL` | Backend URL for the Python card encoder/dispenser service (default: `http://localhost:5000`) |
| `VITE_STANFORD_KEY_GUEST` | Fallback guest name for key-card demos when no reservation has been pushed |
| `VITE_STANFORD_KEY_ROOM` | Fallback room number for key-card demos when no reservation has been pushed |
| `VITE_STANFORD_PAYMENT_QR` | URL/string encoded in the payment QR (staff default uses a demo URL) |
| `VITE_STANFORD_YOUTUBE_EMBED` | Full embed URL for media mode video |
| `VITE_SOCKET_URL` | Override Socket.IO origin (defaults to same host as the Vite dev server) |
| `VITE_JITSI_DOMAIN` | Jitsi domain (default: `meet.jit.si`; use `8x8.vc` for JaaS) |
| `VITE_JITSI_APP_ID` | JaaS app id / magic cookie. When set, rooms become `<app-id>/PrimeDrive_Stanford_<room>` |
| `VITE_JITSI_JWT` | Optional JaaS JWT for the embedded meeting. For production, generate short-lived JWTs server-side instead of hard-coding them in frontend env |
| `STANFORD_HTTPS` | Set `true` to run Vite over HTTPS for LAN staff-laptop camera/mic access |
| `STANFORD_HTTPS_KEY` | Optional HTTPS key path (default: `stanford/certs/dev-key.pem`) |
| `STANFORD_HTTPS_CERT` | Optional HTTPS cert path (default: `stanford/certs/dev-cert.pem`) |

## Video provider

By default the Stanford showcase embeds public Jitsi Meet at `meet.jit.si`, so it is fine for quick demos but not the most controlled production path.

For 8x8 JaaS, set these in `.env` and restart the Vite server:

```bash
VITE_JITSI_DOMAIN=8x8.vc
VITE_JITSI_APP_ID=vpaas-magic-cookie-your-jaas-app-id
JAAS_APP_ID=vpaas-magic-cookie-your-jaas-app-id
JAAS_KID=vpaas-magic-cookie-your-jaas-app-id/your-key-id
JAAS_PRIVATE_KEY_PATH=./secrets/jaas-private-key.pem
```

The app loads the correct JaaS `external_api.js`, prefixes the room with the JaaS app id, and asks the backend for role-specific JWTs. Staff joins as moderator; guest joins as a normal participant. The JaaS private key must stay server-side and should not use the `VITE_` prefix.

### Demo fallback staff launcher

If HTTPS cert setup is fighting you, use the Chrome secure-origin fallback on the staff laptop:

```bash
npm run demo:staff:fallback -- http://10.32.35.221:5174/staff
```

This opens a temporary Chrome profile with `http://10.32.35.221:5174` treated as secure for camera and microphone access. Keep that Chrome window open for the demo. This is a lab fallback, not a production deployment mode.

### Recommended showcase runbook

**Public Jitsi fallback, fastest:**

1. Interface machine terminal 1: encoder Python service
2. Interface machine terminal 2: `npm run dev:backend`
3. Interface machine terminal 3: `npm run dev:stanford`
4. Guest screen: `http://localhost:5174/`
5. Staff laptop: `npm run demo:staff:fallback -- http://<LAN_IP>:5174/staff`

**JaaS, cleaner call behavior:**

1. Add JaaS env vars above.
2. Interface machine terminal 1: encoder Python service
3. Interface machine terminal 2: `npm run dev:backend`
4. Interface machine terminal 3: `npm run dev:stanford`
5. Guest screen: `http://localhost:5174/`
6. Staff laptop: `npm run demo:staff:fallback -- http://<LAN_IP>:5174/staff`

## Concierge flow

Staff panel features:
- **Jitsi video call** with shared room
- **Reservation lookup** (queries backend `/api/checkin/lookup`)
- **Action buttons** to push screens onto the guest tablet (passport camera, payment QR, signature pad, key card, services, map, luggage, etc.)
- **Flow tracker** showing which step the guest is on, with check marks for completed steps
- **Event log** with timestamped entries from the guest
- **Artifact viewer** showing received passport photos, signatures, preferences, and luggage info

### Passport scan modes
- **Guest camera** — opens the tablet's rear camera via getUserMedia, guest captures a photo and sends it to the concierge over Socket.IO
- **Hardware scanner** — triggers the backend passport scanner worker (EasyOCR + ESP32 lighting)

## Architecture

Guest tablet ↔ Socket.IO (`/stanford` namespace) ↔ Staff panel. Both embed Jitsi for video. Backend relays commands between the two roles within a shared room.

## Card encoder / dispenser

The integrated hardware service lives in `stanford/hardware/card-encoder`. Run it on the machine connected to the Arduino dispenser and NFC writer, then set `STANFORD_ENCODER_URL` on the backend machine if it is not `localhost`.

The Stanford guest key-card screen calls backend `POST /api/checkin/issue-key-card`, which proxies to the Python encoder service. It prefers the new `POST /api/issue_card` endpoint and falls back to the original teammate endpoints (`/api/preload` + `/api/issue_primary`) for compatibility.

Full setup, debugging, and handoff notes: [`docs/card-encoder-integration.md`](docs/card-encoder-integration.md)
