import csv
import os
import random
import string
import time
from datetime import datetime

import serial
from flask import Flask, render_template, request, jsonify
from smartcard.System import readers


CSV_FILE = os.environ.get("ENCODER_GUESTS_CSV", "guests.csv")

ARDUINO_PORT = os.environ.get("ENCODER_ARDUINO_PORT", "COM3")
ARDUINO_BAUD = int(os.environ.get("ENCODER_ARDUINO_BAUD", "9600"))
CARD_TIMEOUT_SECONDS = int(os.environ.get("ENCODER_CARD_TIMEOUT_SECONDS", "25"))

arduino = None

app = Flask(__name__)


def get_arduino():
    global arduino

    if arduino is None or not arduino.is_open:
        arduino = serial.Serial(ARDUINO_PORT, ARDUINO_BAUD, timeout=1)
        time.sleep(2)

    return arduino


def send_arduino_command(cmd):
    ser = get_arduino()
    ser.reset_input_buffer()
    ser.write(str(cmd).encode("ascii"))

    while True:
        line = ser.readline().decode(errors="ignore").strip()

        if line:
            print("Arduino:", line)

        if line == "DONE":
            return


def load_data():
    if not os.path.exists(CSV_FILE):
        return []

    with open(CSV_FILE, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def save_data(data):
    with open(CSV_FILE, "w", newline="", encoding="utf-8-sig") as f:
        fieldnames = [
            "Name",
            "Room",
            "PrimaryCardCode",
            "SecondaryCardCode",
            "PrimaryIssuedAt",
            "SecondaryIssuedAt",
        ]

        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)


def find_guest(data, name):
    target = name.strip().lower()
    matches = [row for row in data if row["Name"].strip().lower() == target]
    return matches[0] if matches else None


def ensure_guest(data, name, room):
    guest = find_guest(data, name)

    if guest:
        if room and not guest.get("Room", "").strip():
            guest["Room"] = room
        return guest

    guest = {
        "Name": name,
        "Room": room,
        "PrimaryCardCode": "",
        "SecondaryCardCode": "",
        "PrimaryIssuedAt": "",
        "SecondaryIssuedAt": "",
    }
    data.append(guest)
    return guest


def update_guest_cards(row, primary_code=None, secondary_code=None):
    now = datetime.now().isoformat(timespec="seconds")

    if primary_code is not None:
        row["PrimaryCardCode"] = primary_code
        row["PrimaryIssuedAt"] = now

    if secondary_code is not None:
        row["SecondaryCardCode"] = secondary_code
        row["SecondaryIssuedAt"] = now


def clear_guest_all_cards(row):
    row["PrimaryCardCode"] = ""
    row["SecondaryCardCode"] = ""
    row["PrimaryIssuedAt"] = ""
    row["SecondaryIssuedAt"] = ""


def generate_code(room, card_type):
    rand = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    return f"RM{room}-{card_type}-{rand}"


def transmit(connection, apdu):
    response, sw1, sw2 = connection.transmit(apdu)
    return response, sw1, sw2


def get_connection():
    r = readers()

    if not r:
        raise RuntimeError("No NFC reader found.")

    reader = r[0]
    conn = reader.createConnection()
    conn.connect()
    return conn


def read_uid(conn):
    resp, sw1, sw2 = transmit(conn, [0xFF, 0xCA, 0x00, 0x00, 0x00])

    if (sw1, sw2) != (0x90, 0x00):
        raise RuntimeError("UID read failed")

    return "".join(f"{b:02X}" for b in resp)


def is_card_present():
    try:
        conn = get_connection()
        read_uid(conn)
        return True
    except Exception:
        return False


def wait_for_card(timeout=25):
    start = time.time()

    while time.time() - start < timeout:
        if is_card_present():
            return

        time.sleep(0.3)

    raise RuntimeError("Timeout waiting for card on encoder.")


def wait_until_no_card():
    while True:
        if not is_card_present():
            return

        time.sleep(0.3)


def write_page(conn, page, data4):
    if len(data4) != 4:
        raise ValueError("Each page write requires exactly 4 bytes.")

    apdu = [
        0xFF, 0x00, 0x00, 0x00,
        0x08,
        0xD4, 0x42, 0xA2, page
    ] + list(data4)

    resp, sw1, sw2 = transmit(conn, apdu)

    if (sw1, sw2) != (0x90, 0x00):
        raise RuntimeError(
            f"Write failed on page {page}: SW1={sw1:02X} SW2={sw2:02X}"
        )


def build_ndef_text_tlv(text, lang="en"):
    text_bytes = text.encode("utf-8")
    lang_bytes = lang.encode("ascii")
    status = len(lang_bytes)

    payload = bytes([status]) + lang_bytes + text_bytes
    ndef_record = bytes([0xD1, 0x01, len(payload), 0x54]) + payload
    tlv = bytes([0x03, len(ndef_record)]) + ndef_record + bytes([0xFE])

    if len(tlv) % 4 != 0:
        tlv += b"\x00" * (4 - len(tlv) % 4)

    return tlv


def write_ndef_text(conn, text, start_page=4):
    data = build_ndef_text_tlv(text)

    page = start_page

    for i in range(0, len(data), 4):
        block = data[i:i + 4]
        write_page(conn, page, block)
        page += 1


def issue_one_card(card_label, room):
    conn = get_connection()
    uid = read_uid(conn)

    card_type = "M" if card_label.lower() == "primary" else "S"
    code = generate_code(room, card_type)

    write_ndef_text(conn, code)

    return uid, code


def issue_card_for_guest(name, room=None, card_label="Primary", should_preload=False):
    data = load_data()
    guest = ensure_guest(data, name, (room or "").strip())
    room_number = (room or guest["Room"]).strip()

    if not room_number:
        raise RuntimeError("Room number is required to encode a card.")

    if should_preload:
        send_arduino_command("1")
        wait_for_card(CARD_TIMEOUT_SECONDS)
        send_arduino_command("2")

    wait_for_card(CARD_TIMEOUT_SECONDS)
    uid, code = issue_one_card(card_label, room_number)

    if card_label.lower() == "primary":
        update_guest_cards(guest, primary_code=code)
    else:
        update_guest_cards(guest, secondary_code=code)

    save_data(data)

    send_arduino_command("3")
    wait_until_no_card()
    time.sleep(2)
    send_arduino_command("4")

    return uid, code, guest


@app.route("/")
def home():
    return render_template("encoder.html")


@app.route("/api/find_guest", methods=["POST"])
def api_find_guest():
    try:
        body = request.get_json()
        name = body.get("name", "").strip()

        if not name:
            return jsonify({
                "ok": False,
                "message": "Please enter a guest name."
            })

        data = load_data()
        guest = find_guest(data, name)

        if not guest:
            return jsonify({
                "ok": False,
                "message": "Guest not found."
            })

        return jsonify({
            "ok": True,
            "message": f"Found guest: {guest['Name']}",
            "guest": guest
        })

    except Exception as e:
        return jsonify({
            "ok": False,
            "message": str(e)
        })


@app.route("/api/preload", methods=["POST"])
def api_preload():
    try:
        send_arduino_command("1")
        wait_for_card()
        send_arduino_command("2")

        return jsonify({
            "ok": True,
            "message": "Preload complete. Card is ready to encode."
        })

    except Exception as e:
        return jsonify({
            "ok": False,
            "message": f"Preload failed: {e}"
        })


@app.route("/api/issue_primary", methods=["POST"])
def api_issue_primary():
    try:
        body = request.get_json()
        name = body.get("name", "").strip()

        data = load_data()
        guest = find_guest(data, name)

        if not guest:
            return jsonify({
                "ok": False,
                "message": "Guest not found."
            })

        room = guest["Room"].strip()

        wait_for_card()

        uid, code = issue_one_card("Primary", room)

        update_guest_cards(guest, primary_code=code)
        save_data(data)

        send_arduino_command("3")
        wait_until_no_card()

        time.sleep(2)

        send_arduino_command("4")

        return jsonify({
            "ok": True,
            "message": f"First card written successfully. UID: {uid}, Code: {code}",
            "guest": guest
        })

    except Exception as e:
        return jsonify({
            "ok": False,
            "message": f"Failed during first card sequence: {e}"
        })


@app.route("/api/issue_secondary", methods=["POST"])
def api_issue_secondary():
    try:
        body = request.get_json()
        name = body.get("name", "").strip()

        data = load_data()
        guest = find_guest(data, name)

        if not guest:
            return jsonify({
                "ok": False,
                "message": "Guest not found."
            })

        room = guest["Room"].strip()

        wait_for_card()

        uid, code = issue_one_card("Secondary", room)

        update_guest_cards(guest, secondary_code=code)
        save_data(data)

        send_arduino_command("3")
        wait_until_no_card()

        time.sleep(2)

        send_arduino_command("4")

        return jsonify({
            "ok": True,
            "message": f"Second card written successfully. UID: {uid}, Code: {code}",
            "guest": guest
        })

    except Exception as e:
        return jsonify({
            "ok": False,
            "message": f"Failed during second card sequence: {e}"
        })


@app.route("/api/issue_card", methods=["POST"])
def api_issue_card():
    try:
        body = request.get_json() or {}
        name = body.get("name", "").strip()
        room = str(body.get("room", "")).strip()
        card_label = body.get("cardLabel", "Primary").strip() or "Primary"
        should_preload = bool(body.get("preload", False))

        if not name:
            return jsonify({
                "ok": False,
                "message": "Guest name is required."
            }), 400

        uid, code, guest = issue_card_for_guest(
            name=name,
            room=room,
            card_label=card_label,
            should_preload=should_preload,
        )

        return jsonify({
            "ok": True,
            "message": f"{card_label} card written successfully. UID: {uid}, Code: {code}",
            "uid": uid,
            "code": code,
            "guest": guest
        })

    except Exception as e:
        return jsonify({
            "ok": False,
            "message": f"Failed during card issue sequence: {e}"
        }), 500


@app.route("/api/clear_guest_cards", methods=["POST"])
def api_clear_guest_cards():
    try:
        body = request.get_json()
        name = body.get("name", "").strip()

        data = load_data()
        guest = find_guest(data, name)

        if not guest:
            return jsonify({
                "ok": False,
                "message": "Guest not found."
            })

        clear_guest_all_cards(guest)
        save_data(data)

        return jsonify({
            "ok": True,
            "message": f"Cleared all card records for {guest['Name']}.",
            "guest": guest
        })

    except Exception as e:
        return jsonify({
            "ok": False,
            "message": str(e)
        })


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )
