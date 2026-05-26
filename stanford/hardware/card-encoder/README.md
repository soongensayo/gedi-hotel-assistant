# Stanford Card Encoder Service

This folder keeps the working card encoder/dispenser service with the Stanford showcase code.

## Run on the hardware computer

```bash
cd stanford/hardware/card-encoder
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ENCODER_ARDUINO_PORT=/dev/cu.usbmodemXXXX python encoder.py
```

On Windows, set `ENCODER_ARDUINO_PORT=COM3` or whichever COM port the Arduino uses.

The service listens on `http://0.0.0.0:5000` and exposes:

- `POST /api/issue_card` with `{ "name": "...", "room": "311", "cardLabel": "Primary", "preload": true }`
- The original teammate endpoints such as `POST /api/preload`, `POST /api/issue_primary`, and `POST /api/issue_secondary`

## Connect from the Stanford app

Set this in the repo root `.env` before starting the backend:

```bash
STANFORD_ENCODER_URL=http://localhost:5000
VITE_STANFORD_USE_NFC=true
```

If the encoder is on another computer, replace `localhost` with that machine's LAN IP.
