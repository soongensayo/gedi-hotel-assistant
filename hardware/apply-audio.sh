#!/bin/bash
# Sets ALSA hardware volume to maximum on the Jetson Nano at startup.
# Run `amixer scontrols` to list available control names on your device.
# Common control names for USB audio: Master, Speaker, PCM, Headphone.

set_volume() {
  local control="$1"
  if amixer get "$control" &>/dev/null; then
    amixer set "$control" 100% unmute
    echo "[audio] Set '$control' to 100%"
  fi
}

set_volume "Master"
set_volume "Speaker"
set_volume "PCM"
set_volume "Headphone"
set_volume "Front"

echo "[audio] ALSA volume applied."
