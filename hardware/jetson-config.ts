/**
 * NVIDIA Jetson-specific configuration for the AI Check-in Kiosk.
 * 
 * This file contains settings for hardware peripherals when running
 * on the Jetson platform with real displays, speakers, and input devices.
 * 
 * On laptop (HARDWARE_MODE=mock), these settings are ignored and
 * everything runs through the browser UI.
 */

export const jetsonConfig = {
  // Display settings
  display: {
    // Primary display (hologram / Pepper's Ghost)
    primary: {
      width: 1920,
      height: 1080,
      refreshRate: 60,
      // Set to true if using a transparent display / Pepper's Ghost setup
      transparentMode: true,
      // Chromium launch flags for kiosk mode
      kioskFlags: [
        '--kiosk',
        '--no-first-run',
        '--disable-infobars',
        '--disable-session-crashed-bubble',
        '--noerrdialogs',
        '--disable-translate',
        '--disable-features=TranslateUI',
        '--overscroll-history-navigation=0',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    // Secondary display (touch input panel, if separate)
    secondary: {
      enabled: false,
      width: 1024,
      height: 768,
    },
  },

  // Audio settings
  audio: {
    // ALSA device for speaker output
    outputDevice: 'default',
    // ALSA device for microphone input
    inputDevice: 'default',
    // Volume levels (0-100)
    outputVolume: 80,
    inputGain: 70,
  },

  // GPIO pins (for physical button / LED indicators)
  gpio: {
    // Status LED (optional)
    statusLed: 18,
    // Physical start button (optional)
    startButton: 24,
    // Passport scanner trigger (if using GPIO-connected scanner)
    scannerTrigger: 25,
  },

  // USB devices
  usb: {
    // Passport/document scanner USB path
    passportScanner: '/dev/ttyUSB0',
    // Card reader USB path
    cardReader: '/dev/ttyUSB1',
  },

  // Network
  network: {
    // Backend API URL (local on Jetson)
    backendUrl: 'http://localhost:3001',
    // Frontend URL
    frontendUrl: 'http://localhost:5173',
  },
};
