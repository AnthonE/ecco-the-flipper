# Ecco the flipper

An AI agent that lives on your Flipper Zero.

Ecco turns your Flipper into a standalone hacking assistant — no laptop or phone required. Ask it to capture a signal, read an NFC tag, or identify a protocol, and it actually does it. The AI can see what the Flipper sees, control what it controls, and explain what it finds.

![Status](https://img.shields.io/badge/status-early%20development-orange)
![Flipper](https://img.shields.io/badge/flipper-0.99+-green)
![License](https://img.shields.io/badge/license-CC0-blue)

## How It Works

```
┌─────────────────────┐        ┌─────────────────────┐
│    FLIPPER ZERO     │  UART  │   WIFI DEV BOARD    │
│                     │◄──────►│     (ESP32-S2)      │
│  • Chat UI          │  GPIO  │                     │
│  • Hardware tools   │        │  • WiFi             │
│  • Tool execution   │        │  • Claude API       │
└─────────────────────┘        └─────────────────────┘
                                        │
                                        ▼
                               ┌─────────────────────┐
                               │     Claude API      │
                               └─────────────────────┘
```

The Flipper app handles the UI and hardware. The WiFi board handles the internet. They talk over UART. Everything fits in your pocket.

## Requirements

- Flipper Zero (firmware 0.99+)
- [WiFi Dev Board](https://shop.flipperzero.one/products/wifi-devboard) (official ESP32-S2 board)
- Anthropic API key
- WiFi network

## Installation

### Flash the WiFi Board

1. Download the latest Ecco ESP32 firmware from [Releases](https://github.com/yourname/ecco/releases)
2. Put your WiFi board into bootloader mode (hold BOOT while plugging in USB)
3. Flash using esptool:
```bash
esptool.py --chip esp32s2 write_flash 0x0 ecco-esp32-vX.X.X.bin
```

### Install the Flipper App

1. Download `ecco.fap` from [Releases](https://github.com/yourname/ecco/releases)
2. Copy to `SD Card/apps/GPIO/ecco.fap`
3. Or build from source:
```bash
cd flipper
./fbt fap_ecco
```

### Configure

1. Open Ecco on your Flipper
2. Go to Settings
3. Enter your WiFi credentials
4. Enter your Anthropic API key

## Usage

1. Plug in the WiFi dev board
2. Launch Ecco from Apps → GPIO
3. Type a message and press OK

**Example prompts:**
- "What NFC card is this?"
- "Capture whatever signal I'm about to send"
- "Turn off the TV"
- "Read this RFID tag and save it"
- "What protocol is this remote using?"

## Project Structure

```
ecco/
├── flipper/              # Flipper Zero app (C)
│   ├── ecco.c            # Entry point
│   ├── ui/               # Chat view, text input, settings
│   ├── agent/            # Tool dispatch, message handling
│   ├── hardware/         # SubGHz, NFC, IR, RFID wrappers
│   └── comms/            # UART protocol
│
├── esp32/                # ESP32-S2 firmware (Rust)
│   ├── src/
│   │   ├── main.rs       # Entry point
│   │   ├── wifi.rs       # WiFi connection
│   │   ├── api.rs        # Claude API client
│   │   ├── uart.rs       # UART protocol
│   │   └── protocol.rs   # Message types
│   └── Cargo.toml
│
├── protocol/             # Shared protocol definitions
│   └── schema.md
│
└── docs/
    ├── ARCHITECTURE.md
    ├── TOOLS.md
    └── CONTRIBUTING.md
```

## Available Tools

| Tool | Description | Status |
|------|-------------|--------|
| `device_info` | Get Flipper device info | 🟢 Done |
| `subghz_capture` | Capture Sub-GHz signal | 🟡 In Progress |
| `subghz_transmit` | Transmit saved signal | 🟡 In Progress |
| `nfc_read` | Read NFC tag | 🔴 Planned |
| `nfc_emulate` | Emulate NFC tag | 🔴 Planned |
| `ir_receive` | Capture IR signal | 🔴 Planned |
| `ir_transmit` | Transmit IR signal | 🔴 Planned |
| `rfid_read` | Read 125kHz RFID | 🔴 Planned |
| `storage_list` | List files | 🔴 Planned |
| `storage_read` | Read file | 🔴 Planned |

## Roadmap

- [x] Project structure
- [ ] ESP32 WiFi + Claude API connection
- [ ] Flipper FAP skeleton with chat UI
- [ ] UART protocol between boards
- [ ] First tool working end-to-end
- [ ] Core tools (SubGHz, NFC, IR)
- [ ] Settings persistence
- [ ] Error handling and recovery
- [ ] v0.1 release

## Building from Source

### ESP32 Firmware

Requires Rust and esp-rs toolchain:

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install esp-rs
cargo install espup
espup install

# Build
cd esp32
cargo build --release

# Flash
cargo espflash flash --release
```

### Flipper App

Requires the Flipper firmware repo:

```bash
# Clone firmware
git clone --recursive https://github.com/flipperdevices/flipperzero-firmware.git
cd flipperzero-firmware

# Clone Ecco into applications_user
git clone https://github.com/yourname/ecco.git applications_user/ecco

# Build
./fbt fap_ecco

# Flash
./fbt launch_app APPSRC=ecco
```

## Contributing

This project is in early development. Contributions welcome!

1. Fork the repo
2. Create a branch (`git checkout -b feature/cool-thing`)
3. Commit your changes
4. Push and open a PR

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for more details.

## FAQ

**Why Claude and not local LLM?**

The ESP32-S2 has 2MB of RAM. Local models need gigabytes. Maybe someday with better edge AI, but for now, cloud it is.

**How much does it cost to run?**

Claude API pricing is ~$3/million input tokens, ~$15/million output tokens. A typical conversation with tool use might cost $0.01-0.05. Not free, but cheap.

**Can I use OpenAI/Ollama/etc instead?**

Not yet. Claude's tool use is what makes the agent work well. PRs welcome for other backends.

**Will this brick my Flipper?**

No. It's just an app. Delete the `.fap` file and it's gone.

**Is this legal?**

Ecco is a tool. Don't do illegal things with it.

## License

CC0 License. See [LICENSE](LICENSE).

## Acknowledgments

- [Flipper Devices](https://flipperzero.one) for the hardware and SDK
- [Anthropic](https://anthropic.com) for Claude
- [esp-rs](https://github.com/esp-rs) for making Rust on ESP32 actually good
- The Flipper community for documentation and examples

---

**Ecco** — *Talk to your Flipper.*
