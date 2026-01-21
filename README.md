# Ecco

An AI agent that controls your Flipper Zero.

Ecco turns your Flipper into a wireless hacking assistant. Connect from any browser, chat with Claude, and let the AI control SubGHz, NFC, IR, and RFID hardware directly. The AI sees what the Flipper sees and does what you ask.

![Status](https://img.shields.io/badge/status-early%20development-orange)
![Flipper](https://img.shields.io/badge/flipper-0.99+-green)
![License](https://img.shields.io/badge/license-CC0-blue)

## How It Works

```
┌─────────────────────┐         ┌─────────────────────┐         ┌─────────────────────┐
│      Browser        │  WiFi   │       ESP32         │  UART   │    Flipper Zero     │
│                     │◄───────►│                     │◄───────►│                     │
│  • Chat UI          │         │  • Serves webapp    │         │  • SubGHz           │
│  • Claude API       │         │  • Tool API         │         │  • NFC              │
│  • Agent logic      │         │  • UART bridge      │         │  • IR               │
└─────────────────────┘         └─────────────────────┘         │  • RFID             │
         │                                                      └─────────────────────┘
         ▼
┌─────────────────────┐
│     Claude API      │
└─────────────────────┘
```

1. ESP32 creates a WiFi access point (or joins your network)
2. You open the ESP32's IP in any browser
3. Chat with Claude — it calls tools that execute on the Flipper
4. Results come back through the same path

## Requirements

- Flipper Zero (firmware 0.99+)
- [WiFi Dev Board](https://shop.flipperzero.one/products/wifi-devboard) (ESP32-S2)
- Anthropic API key
- Any device with a browser (phone, laptop, tablet)

## Quick Start

### 1. Flash the ESP32

```bash
# Download firmware from Releases, then:
esptool.py --chip esp32s2 write_flash 0x0 ecco-esp32.bin
```

### 2. Install the Flipper App

Copy `ecco.fap` from [Releases](https://github.com/AnthonE/ecco-the-flipper/releases) to your SD card at `apps/GPIO/ecco.fap`.

### 3. Connect

1. Plug in the WiFi dev board
2. Launch Ecco on Flipper (Apps → GPIO → Ecco)
3. Connect to the `Ecco` WiFi network (or your configured network)
4. Open `http://192.168.4.1` in your browser
5. Enter your Anthropic API key
6. Start chatting

## Example Prompts

- "What NFC card is this?"
- "Capture the next signal I send"
- "Clone this garage remote"
- "Turn off the TV"
- "What protocol is this remote using?"
- "Save this RFID tag as 'work badge'"

## Project Structure

```
ecco/
├── webapp/               # Browser UI (HTML/JS)
│   ├── index.html
│   ├── app.js           # Claude API + tool handling
│   └── style.css
│
├── esp32/                # ESP32 firmware (Rust)
│   ├── src/
│   │   ├── main.rs      # Entry point
│   │   ├── wifi.rs      # WiFi AP/client
│   │   ├── http.rs      # Web server + API
│   │   └── uart.rs      # Flipper communication
│   └── Cargo.toml
│
├── flipper/              # Flipper app (C)
│   ├── ecco.c           # Entry point
│   ├── tools/           # Hardware tool implementations
│   └── uart/            # Protocol handling
│
└── protocol/             # Shared protocol spec
    └── schema.md
```

## Available Tools

| Tool | Description | Status |
|------|-------------|--------|
| `device_info` | Get Flipper info | 🔴 Planned |
| `subghz_capture` | Capture Sub-GHz signal | 🔴 Planned |
| `subghz_transmit` | Transmit saved signal | 🔴 Planned |
| `nfc_read` | Read NFC tag | 🔴 Planned |
| `nfc_emulate` | Emulate NFC tag | 🔴 Planned |
| `ir_receive` | Capture IR signal | 🔴 Planned |
| `ir_transmit` | Transmit IR signal | 🔴 Planned |
| `rfid_read` | Read 125kHz RFID | 🔴 Planned |
| `storage_list` | List files on SD | 🔴 Planned |
| `storage_read` | Read file from SD | 🔴 Planned |

## Roadmap

- [x] Project planning
- [ ] Protocol spec (ESP32 ↔ Flipper)
- [ ] ESP32 firmware (WiFi + HTTP server + UART)
- [ ] Flipper FAP (tool executor)
- [ ] Webapp (chat UI + Claude integration)
- [ ] First tool end-to-end (device_info)
- [ ] Core hardware tools
- [ ] v0.1 release

## Building from Source

### ESP32 Firmware

```bash
# Install Rust + esp-rs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install espup
espup install

# Build and flash
cd esp32
cargo build --release
cargo espflash flash --release
```

### Flipper App

```bash
# Clone firmware repo
git clone --recursive https://github.com/flipperdevices/flipperzero-firmware.git
cd flipperzero-firmware

# Link Ecco
ln -s /path/to/ecco/flipper applications_user/ecco

# Build and run
./fbt fap_ecco
./fbt launch_app APPSRC=ecco
```

### Webapp

The webapp is served directly from the ESP32. During development:

```bash
cd webapp
python -m http.server 8000
# Open http://localhost:8000
```

## FAQ

**Why Claude instead of a local LLM?**

Tool use. Claude is exceptionally good at understanding when and how to use tools. Local models are getting better but aren't there yet for reliable agent behavior.

**How much does it cost?**

Claude API costs ~$3/million input tokens, ~$15/million output tokens. A typical session might cost $0.01-0.05.

**Is my API key safe?**

Your API key stays in your browser and is sent directly to Anthropic. It never touches the ESP32 or Flipper.

**Will this brick my Flipper?**

No. It's just an app. Delete the `.fap` file to uninstall.

**Is this legal?**

Ecco is a tool. Use it responsibly and legally.

## License

CC0 — Public Domain. See [LICENSE](LICENSE).

---

**Ecco** — *Your Flipper, smarter.*
