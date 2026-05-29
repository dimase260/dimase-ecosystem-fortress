---
name: Flipper Zero
description: Flipper Zero device ownership, capabilities, and project ideas
type: project
---

# Flipper Zero

**Acquired:** 2026-03-17
**Owner:** Christopher DiMase

## Device Overview
- Portable multi-tool for pentesters, hackers, and tinkerers
- ARM Cortex-M4 @ 64 MHz, 1MB Flash, 256KB RAM
- Built-in display (128x64 monochrome), 5-way directional pad, back button
- USB-C, microSD card slot, GPIO pins (Arduino-compatible)
- MicroPython scripting support via qFlipper or Flipper Lab

## Built-in Hardware Radios & Modules
| Module | Frequency / Protocol |
|--------|---------------------|
| Sub-GHz radio (CC1101) | 300–928 MHz — garage doors, car fobs, doorbells, weather stations |
| 125 kHz RFID | EM4100, HID Prox, Indala — old-school access cards |
| NFC (ST25R3916) | 13.56 MHz — ISO 14443A/B, ISO 15693, NFC-A/B/V (Mifare, NTAG, EMV read) |
| Infrared (IR) | TX + RX — universal remote, learning remotes |
| iButton (1-Wire) | Dallas/Maxim keys (DS1990, Cyfral, Metakom) |
| GPIO / SPI / I2C / UART | Expansion modules, BadUSB (rubber ducky), custom hardware |
| BadUSB (USB-HID) | Acts as keyboard/mouse — script injection via USB |

## Devices
- **Flipster** — primary Flipper Zero (name set on device), flashing Unleashed v086e (2026-03-24)
- 2 SD cards in use — both loaded with identical setup (see SD Card Setup below)

## Firmware
- **Unleashed v086e** ✅ INSTALLED (2026-03-24) — removes region locks, extra protocols, base+extra apps bundled
  - Update package on SD: `update/f7-update-unlshd-086e/` → select `update` → Run in App
  - Download: github.com/DarkFlippers/unleashed-firmware/releases/tag/unlshd-086
- **Official Flipper firmware** — stable, Flipper Lab app store
- **RogueMaster** — everything in Unleashed + extra community apps
- Flash via qFlipper desktop app or `ufbt` CLI

## Capability Areas

### Sub-GHz
- Read/save/replay RF signals (rolling codes are capture-only, not replayable without special attack)
- Supported: static-code garage openers, car lock signals (older vehicles), weather sensors, doorbells, alarm sensors
- **Flipper captures raw signals** — static codes can be replayed; rolling codes (KeeLoq, AUT64) cannot without brute-force/compute attacks

### NFC / RFID
- Clone 125kHz access cards (EM4100, HID) to blank T5577 cards
- Read Mifare Classic (requires dictionary or MFKEY32 cracking for encrypted sectors)
- Emulate NFC cards — tap-to-pay simulation, loyalty cards
- Read EMV bank cards (PAN, expiry — no CVV, no PIN, no full track data)

### Infrared
- Universal remote — learn existing TV/AC/projector codes
- Built-in IR library (Samsung, LG, Sony, Panasonic, etc.)
- Capture and replay arbitrary IR signals

### BadUSB
- Rubber Ducky-compatible `.txt` Ducky Script files
- Can type payloads, open terminals, run commands — legit use: automation, IT admin scripts
- Great for: auto-login scripts, custom keyboard shortcuts injection

### GPIO / Hardware Hacking
- Connect to UART on routers/IoT devices (serial console access)
- SPI/I2C for reading EEPROM chips, flashing firmware
- Logic analyzer via Saleae-compatible mode (with right app)
- Wire Flipper into the BuyVM homelab hardware projects

## Integration Ideas with DiMase Ecosystem

### DiMase AI Integration
- Build a Flipper script that POSTs to `/dimase/bot-chat` via Wi-Fi dev board (ESP32 module)
- Voice commands from Flipper → DiMase AI on dimaseinc.org
- Flipper as a physical DiMase AI trigger button

### DiMaseHome / Server
- Flipper BadUSB script → auto-runs `usb-login.sh` equivalent keyboard sequence on login screen
- GPIO → relay → physical server power button (Wake on LAN alternative)

### Locksmith Integration
- Sub-GHz: demo RFID/NFC card cloning for locksmith service knowledge
- Access card analysis for customer consultations

### USB Hardware Key Enhancement
- Add Flipper NFC emulation as a secondary hardware auth token
- Program an NFC tag with USB_AUTH_TOKEN payload

## Accessories / Expansion Modules
- **Wi-Fi Dev Board** (ESP32-S2) ✅ OWNED — Marauder v1.11.0 `.bin` on SD at `apps_data/esp_flasher/marauder_flipper.bin` — flash via ESP Flasher app; enables: Evil Portal, Deauth, packet sniffing, WiFi map
- **Video Game Module (VGM)** ✅ OWNED — STM32W5, GPIO top slot, Bluetooth gamepad mode, runs Doom/Snake/Tetris, can act as BT controller for PC/phone; apps in `apps/Games/`
- **ESP32/2.4 GHz GPIO Board** ✅ OWNED — NRF24 apps installed: `nrf24_scanner.fap`, `nrf24_mouse_jacker_ms.fap`, `nrf24_sniffer_ms.fap`, `nrf24tool.fap` in `apps/GPIO/`
- **Raspberry Pi Zero** via GPIO for full Linux integration

## SD Card Setup (2026-03-24)
- **2 SD cards** — both loaded identically
- **Big card** = primary (goes in Flipster), small card = backup
- Unleashed v086e flashed to Flipster ✅
- Rename device: Settings → Desktop → Flipper Name → "Flipster"

### Apps (from xMasterX/all-the-plugins 22mar2026)
- `apps/GPIO/` — 53 apps (cleaned: removed sensor/hardware apps not owned)
- `apps/Games/` — 76 games including VGM-compatible
- `apps/Bluetooth/`, `apps/NFC/`, `apps/RFID/`, `apps/Sub-GHz/`, `apps/Infrared/`, `apps/Tools/`, `apps/USB/`, `apps/iButton/`, `apps/Media/`
- Removed: ESP8266 apps, Geiger, GPS, LoRa, servo testers, CO2 sensors, LED strip, Misc folder (dupes)

### Databases loaded on both cards
- `subghz/` — 11,947 files (UberGuidoZ + TouchTunes + T119 pagers + brute-force + concert bracelets)
- `infrared/` — 9,094 files (Flipper-IRDB 49 categories + UberGuidoZ IR)
- `badusb/` — 1,063 payloads (hak5, aleff, I-Am-Jakoby, MarkCyber, FalsePhilosopher, UberGuidoZ)
- `nfc/` — 1,711 dumps (Amiibo, Tonies, UberGuidoZ)
- `ibutton/` — 109 intercom keys (wetox-team, Flipper-Starnew)
- `lfrfid/` — 20 RFID dumps
- `apps_data/esp_flasher/marauder_flipper.bin` — Marauder v1.11.0 for Flipper WiFi dev board (S2)
- `apps_data/esp_flasher/marauder_kit.bin` — Marauder v1.11.0 for ESP32+NRF24 combo board
- `apps_data/uart_terminal/` — UberGuidoZ WiFi dev board scripts
- `update/f7-update-unlshd-086e/` — Unleashed firmware staged

### ESP32+NRF24 board flashed (2026-03-24)
- Chip: ESP32-D0WD-V3 rev3.1, 4MB flash, MAC: a0:b7:65:dd:f6:20
- Flashed via esptool directly (4 files at correct offsets: 0x1000/0x8000/0xE000/0x10000)
- Marauder v1.11.0 kit build running ✅
- esptool installed: `python3 -m esptool`
- Flash command: `python3 -m esptool --chip esp32 --port /dev/ttyUSB0 --baud 460800 write-flash -z 0x1000 bootloader.bin 0x8000 partitions.bin 0xE000 boot_app0.bin 0x10000 marauder_kit.bin`

## Software / Tools
- **qFlipper** — desktop companion (firmware updates, file manager, screen mirror)
- **Flipper Lab** (lab.flipper.net) — app store, online tools
- **ufbt** — CLI SDK for building custom Flipper apps in C
- **Flipper Scripts** — MicroPython scripting (limited but growing)
- **all-the-plugins** (xMasterX) — community app pack installed on both SD cards

## Legal Notes
- Always get written permission before testing on systems/property you don't own
- Sub-GHz replay attacks on car fobs = federal offense without authorization
- NFC/RFID cloning for own cards = fine; cloning others' cards = illegal
- BadUSB requires physical access — only use on your own machines
- This device is for learning, homelab, and authorized security testing

## Local Machine Connection
- Device: `/dev/ttyACM0` (CDC ACM serial)
- idVendor=0483, idProduct=5740
- Serial: `flip_Dimase`, Product: `Dimase`, Mfr: Flipper Devices Inc.
- Connect: `screen /dev/ttyACM0 115200` or `minicom -D /dev/ttyACM0 -b 115200`
- May need: `sudo usermod -aG dialout dimase` for non-root serial access

## Resources
- Official docs: docs.flipper.net
- Community: github.com/djsime1/awesome-flipperzero
- Unleashed firmware: github.com/DarkFlippers/unleashed-firmware
- Sub-GHz database: github.com/UberGuidoZ/Flipper
