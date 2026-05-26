# Stanford Card Encoder Integration

This note is the handoff for the Stanford showcase card encoder/dispenser work.

## What "Hardware Computer" Means

The hardware computer is the machine your teammate has been testing the physical encoder/dispenser with.

It is the computer that has:

- The Arduino/dispenser plugged in by USB
- The NFC/card writer plugged in by USB
- The working Python encoder service running
- The correct serial/COM port for the Arduino

The Stanford guest/staff app does not need the hardware plugged into the same machine. It only needs to reach the hardware computer over HTTP.

## Current Architecture

```text
Staff panel
  |
  | Socket.IO command: dispense_key_card
  v
Guest tablet key-card screen
  |
  | POST /api/checkin/issue-key-card
  v
Node backend on port 3001
  |
  | POST <STANFORD_ENCODER_URL>/api/issue_card
  v
Python encoder service on port 5000
  |
  | serial + NFC writer commands
  v
Arduino dispenser + NFC card writer
```

The Python encoder service lives at:

```text
stanford/hardware/card-encoder/
```

The Stanford frontend talks only to the backend. The backend proxies the request to the Python encoder service, which can be on the same computer or another computer on the same network.

## Files Added or Changed

- `stanford/hardware/card-encoder/encoder.py`
  - Integrated copy of teammate's working encoder app.
  - Adds `POST /api/issue_card`, which accepts guest name and room number directly.
  - Keeps original endpoints like `/api/preload`, `/api/issue_primary`, and `/api/issue_secondary`.

- `backend/src/routes/checkin.ts`
  - Adds `POST /api/checkin/issue-key-card`.
  - Proxies Stanford key-card requests to the Python encoder service.
  - Falls back to the older teammate endpoints if `/api/issue_card` is not present.

- `backend/src/config/index.ts`
  - Adds `STANFORD_ENCODER_URL`.

- `stanford/src/screens/KeyCardScreen.tsx`
  - Calls the real encoder when `VITE_STANFORD_USE_NFC=true`.
  - Keeps the demo/manual path when hardware mode is off.

- `stanford/src/screens/ConciergeCallScreen.tsx`
  - Passes guest name and room number into the key-card screen.
  - Uses fallback env values if no reservation has been pushed yet.

- `stanford/src/services/api.ts`
  - Adds `issueKeyCard()`.

## Setup Option A: Everything on One Computer

Use this if the Stanford app/backend and the hardware are all on the same computer.

Terminal 1, start the encoder:

```bash
cd stanford/hardware/card-encoder
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ENCODER_ARDUINO_PORT=/dev/cu.usbmodemXXXX python encoder.py
```

On Windows PowerShell:

```powershell
cd stanford\hardware\card-encoder
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
$env:ENCODER_ARDUINO_PORT="COM3"
python encoder.py
```

Terminal 2, repo root `.env`:

```bash
VITE_STANFORD_USE_NFC=true
STANFORD_ENCODER_URL=http://localhost:5000
```

Then start the Stanford app/backend. The one-command path is:

```bash
npm run dev
```

The lab-friendly split-terminal path is:

```bash
# Terminal 2, repo root
npm run dev:backend

# Terminal 3, repo root
npm run dev:stanford
```

Use the split-terminal path when debugging because backend logs and Vite/frontend logs are easier to read separately.

Open:

```text
Guest: http://localhost:5174/
Staff: http://localhost:5174/staff
```

## Setup Option B: Hardware on Teammate's Computer

Use this if your teammate's computer has the Arduino/NFC setup, and another computer runs the Stanford app/backend.

On your teammate's hardware computer:

```bash
cd stanford/hardware/card-encoder
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ENCODER_ARDUINO_PORT=/dev/cu.usbmodemXXXX python encoder.py
```

On Windows PowerShell:

```powershell
cd stanford\hardware\card-encoder
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
$env:ENCODER_ARDUINO_PORT="COM3"
python encoder.py
```

Find the hardware computer's LAN IP.

macOS:

```bash
ipconfig getifaddr en0
```

Windows:

```powershell
ipconfig
```

Look for an IP like `192.168.x.x`.

On the app/backend computer, set repo root `.env`:

```bash
VITE_STANFORD_USE_NFC=true
STANFORD_ENCODER_URL=http://192.168.x.x:5000
```

Replace `192.168.x.x` with the hardware computer's actual IP.

Then start the Stanford app/backend. The one-command path is:

```bash
npm run dev
```

The lab-friendly split-terminal path is:

```bash
# Terminal 2, repo root
npm run dev:backend

# Terminal 3, repo root
npm run dev:stanford
```

Use the split-terminal path when debugging because backend logs and Vite/frontend logs are easier to read separately.

## Recommended Lab Runbook

This is the current known-good lab setup when the interface machine is connected to the dispenser/NFC hardware and another laptop is used as the staff machine.

### Interface Machine

Terminal 1, Python encoder/dispenser service:

```powershell
cd stanford\hardware\card-encoder
.venv\Scripts\activate
$env:ENCODER_ARDUINO_PORT="COM3"
py encoder.py
```

If `py` is not available but `python` is, use:

```powershell
python encoder.py
```

Terminal 2, backend:

```powershell
npm run dev:backend
```

Terminal 3, Stanford frontend:

```powershell
npm run dev:stanford
```

Open the guest interface on the interface machine:

```text
http://localhost:5174/
```

### Staff Laptop

Open the staff panel using the interface machine's Vite network URL:

```text
http://<interface-machine-ip>:5174/staff
```

Example from one lab run:

```text
http://10.32.35.221:5174/staff
```

### Expected Ports

```text
Python encoder service: http://localhost:5000
Node backend:           http://localhost:3001
Stanford frontend:      http://localhost:5174
```

The guest/staff frontend must be able to reach the backend, and the backend must be able to reach the Python encoder service.

### Root `.env` On Interface Machine

The `.env` file should be in the repo root, next to `package.json`, not inside `stanford/`.

```bash
VITE_STANFORD_USE_NFC=true
STANFORD_ENCODER_URL=http://localhost:5000
VITE_STANFORD_KEY_GUEST=Test Guest
VITE_STANFORD_KEY_ROOM=311
```

Restart `npm run dev:stanford` after changing any `VITE_` env var. Vite reads these at frontend startup time.

### Quick Health Checks

Check backend is running:

```powershell
Invoke-RestMethod -Uri "http://localhost:3001/api/health"
```

Check backend can trigger the encoder/dispenser:

```powershell
$body = @{
  guestName = "Test Guest"
  roomNumber = "311"
  cardLabel = "Primary"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3001/api/checkin/issue-key-card" -Method Post -ContentType "application/json" -Body $body
```

Check Python encoder directly:

```powershell
$body = @{
  name = "Test Guest"
  room = "311"
  cardLabel = "Primary"
  preload = $true
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:5000/api/issue_card" -Method Post -ContentType "application/json" -Body $body
```

Only test the UI flow after these checks work.

## Showcase Flow

1. Start the Python encoder service on the hardware computer.
2. Start the backend and Stanford frontend on the app/backend computer. Use either `npm run dev`, or the split path `npm run dev:backend` and `npm run dev:stanford`.
3. Open guest tablet at `http://localhost:5174/` or the LAN URL shown by Vite.
4. Open staff panel at `http://localhost:5174/staff`.
5. In staff panel, optionally look up and push a reservation.
6. Click `Key card / drawer`.
7. Guest tablet shows the key-card screen.
8. If `VITE_STANFORD_USE_NFC=true`, the guest screen calls the backend.
9. Backend calls the Python encoder service.
10. Encoder preloads, writes the card, dispenses it, and returns success.

If no reservation is pushed first, the key-card flow uses:

```bash
VITE_STANFORD_KEY_GUEST=Stanford Guest
VITE_STANFORD_KEY_ROOM=311
```

You can override those in `.env`.

## Debug Checklist

### 1. Is the Python encoder service running?

From the hardware computer:

```bash
curl http://localhost:5000/
```

From the app/backend computer:

```bash
curl http://192.168.x.x:5000/
```

If this fails from the app/backend computer, check:

- Same WiFi/network
- Correct LAN IP
- Firewall allows Python/Flask
- Encoder service is running with `host="0.0.0.0"`

### 2. Can the encoder issue a card directly?

From the app/backend computer:

```bash
curl -X POST http://192.168.x.x:5000/api/issue_card \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Guest","room":"311","cardLabel":"Primary","preload":true}'
```

Expected success shape:

```json
{
  "ok": true,
  "message": "Primary card written successfully...",
  "uid": "...",
  "code": "RM311-M-..."
}
```

If this fails:

- Check `ENCODER_ARDUINO_PORT`
- Check NFC reader is plugged in and detected
- Check a blank card is available/on the encoder when prompted
- Watch Python terminal logs for the actual hardware error

### 3. Can the Node backend reach the encoder?

From the app/backend computer:

```bash
curl -X POST http://localhost:3001/api/checkin/issue-key-card \
  -H "Content-Type: application/json" \
  -d '{"guestName":"Test Guest","roomNumber":"311","cardLabel":"Primary"}'
```

If this fails:

- Check `STANFORD_ENCODER_URL`
- Make sure the backend is running with `npm run dev:backend` or the combined `npm run dev`
- Restart `npm run dev:backend` after changing backend env vars such as `STANFORD_ENCODER_URL`
- Check backend logs for `[Stanford Encoder]`

### 4. Does the UI trigger the flow?

In staff panel:

```text
Guest actions -> Key card / drawer
```

If the UI only shows the demo/manual key-card button, check:

```bash
VITE_STANFORD_USE_NFC=true
```

Then restart Vite. `VITE_` env vars are read at frontend startup/build time.

If the staff button changes the guest screen to `key-card` but no request reaches the Python encoder service, check:

- The guest page is open and refreshed after `VITE_STANFORD_USE_NFC=true`
- `npm run dev:stanford` was restarted after editing `.env`
- The frontend is not still using mock mode
- Temporarily forcing `const useNfcHardware = true` in `stanford/src/screens/ConciergeCallScreen.tsx` can prove whether the remaining issue is only env loading

If Vite logs a proxy error like `ECONNREFUSED ::1:3001`, Windows may be resolving `localhost` to IPv6 while the backend is listening on IPv4. In `stanford/vite.config.ts`, change both proxy targets from:

```ts
target: 'http://localhost:3001',
```

to:

```ts
target: 'http://127.0.0.1:3001',
```

Then restart `npm run dev:stanford`.

## Common Issues

### Wrong Arduino port

Windows usually uses `COM3`, `COM4`, etc.

macOS usually uses something like:

```text
/dev/cu.usbmodemXXXX
/dev/cu.usbserial-XXXX
```

List serial devices on macOS:

```bash
ls /dev/cu.*
```

### Flask is only reachable locally

The encoder script should run with:

```python
host="0.0.0.0"
```

This is already set in `encoder.py`.

### Firewall blocks port 5000

If the hardware computer is Windows/macOS, allow Python through the firewall or temporarily allow inbound port `5000` for the demo network.

### Guest not found

The new `/api/issue_card` endpoint creates/updates CSV guest rows automatically from name and room.

The old `/api/issue_primary` endpoint still requires the guest to already exist in `guests.csv`.

The backend tries `/api/issue_card` first, then falls back to the old path only if `/api/issue_card` returns `404`.

## Good Defaults for Showcase

Root `.env` on the app/backend computer:

```bash
VITE_STANFORD_USE_NFC=true
STANFORD_ENCODER_URL=http://localhost:5000
VITE_STANFORD_KEY_GUEST=Stanford Guest
VITE_STANFORD_KEY_ROOM=311
```

If the hardware is on your teammate's computer:

```bash
VITE_STANFORD_USE_NFC=true
STANFORD_ENCODER_URL=http://192.168.x.x:5000
VITE_STANFORD_KEY_GUEST=Stanford Guest
VITE_STANFORD_KEY_ROOM=311
```

## Verification Already Done

These passed after the integration:

```bash
cd stanford && npm run build
cd backend && npm run build
PYTHONPYCACHEPREFIX=/private/tmp/codex-pycache python3 -m py_compile stanford/hardware/card-encoder/encoder.py
```

`npm run dev` also started successfully after granting local server permission.

Current dev URLs from that run:

```text
Backend: http://localhost:3001
Guest: http://localhost:5174/
Staff: http://localhost:5174/staff
LAN: http://192.168.86.26:5174/
```

The LAN IP will change depending on the network.

## Next Steps

1. Test direct encoder call with the real hardware.
2. Test backend proxy call.
3. Test staff button to guest key-card screen end to end.
4. Decide whether the showcase will use one computer or two computers.
5. If two computers, write down the hardware computer's LAN IP before the demo.
6. Consider adding a staff-side encoder status panel later, so the concierge can see encoder availability before pushing the key-card step.
