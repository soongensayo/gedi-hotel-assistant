# LuxeDrive — Stanford showcase (in-car tablet)

## Quick start

```bash
# From repo root
npm run dev        # backend + stanford (default)
npm run dev:nus    # backend + original NUS kiosk (port 5173)
```

- **Guest tablet:** http://localhost:5174/
- **Concierge panel:** http://localhost:5174/staff

## Multi-device demo

The Vite dev server binds to `0.0.0.0` so any device on the same network can reach it. Backend CORS is permissive in dev mode.

1. Find your machine's LAN IP (`ipconfig getifaddr en0` on macOS, or `hostname -I` on Linux).
2. On the **guest tablet**: open `http://<LAN_IP>:5174/`
3. On the **staff laptop**: open `http://<LAN_IP>:5174/staff` (or just `localhost:5174/staff` if it's the same machine)
4. Both devices share the same Jitsi room and Socket.IO room — concierge actions appear on the guest tablet in real time.

> Camera-based passport scanning requires HTTPS on non-localhost origins. For a quick workaround you can use `ngrok http 5174` or Chrome's `chrome://flags/#unsafely-treat-insecure-origin-as-secure` flag on the tablet.

## Env (optional, in repo root `.env`)

| Variable | Purpose |
|----------|---------|
| `VITE_STANFORD_ROOM_ID` | Shared session id for Socket.IO + Jitsi room suffix (default: `luxe-demo`) |
| `VITE_STANFORD_USE_NFC` | Set `true` to poll real NFC during key-card step |
| `VITE_STANFORD_PAYMENT_QR` | URL/string encoded in the payment QR (staff default uses a demo URL) |
| `VITE_STANFORD_YOUTUBE_EMBED` | Full embed URL for media mode video |
| `VITE_SOCKET_URL` | Override Socket.IO origin (defaults to same host as the Vite dev server) |

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
