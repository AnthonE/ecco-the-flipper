# Ecco Protocol Specification

Binary protocol for ESP32 ↔ Flipper communication over UART.

## Physical Layer

- **Baud rate:** 115200
- **Data bits:** 8
- **Parity:** None
- **Stop bits:** 1
- **Flow control:** None

## Frame Format

```
┌───────┬────────┬──────┬─────┬─────────┬─────────┬──────────┐
│ START │ LENGTH │ SEQ  │ CMD │ STATUS  │ PAYLOAD │ CHECKSUM │
│ 1B    │ 2B     │ 1B   │ 1B  │ 1B      │ 0-1024B │ 1B       │
└───────┴────────┴──────┴─────┴─────────┴─────────┴──────────┘
```

| Field    | Size    | Description                                    |
|----------|---------|------------------------------------------------|
| START    | 1 byte  | Frame start marker: `0xEC`                     |
| LENGTH   | 2 bytes | Payload length (little-endian, max 1024)       |
| SEQ      | 1 byte  | Sequence number (for request/response matching)|
| CMD      | 1 byte  | Command ID (see below)                         |
| STATUS   | 1 byte  | Status code (0x00 for requests)                |
| PAYLOAD  | 0-1024  | Command-specific data                          |
| CHECKSUM | 1 byte  | XOR of all bytes from LENGTH to PAYLOAD        |

## Status Codes

| Code | Name           | Description                    |
|------|----------------|--------------------------------|
| 0x00 | OK             | Success (or request)           |
| 0x01 | ERR_UNKNOWN    | Unknown error                  |
| 0x02 | ERR_INVALID    | Invalid command or payload     |
| 0x03 | ERR_BUSY       | Device busy                    |
| 0x04 | ERR_TIMEOUT    | Operation timed out            |
| 0x05 | ERR_NOT_FOUND  | Resource not found             |
| 0x06 | ERR_NO_DATA    | No data available              |

## Commands

### 0x01 - PING

Health check.

**Request payload:** None

**Response payload:** None

---

### 0x02 - DEVICE_INFO

Get Flipper device information.

**Request payload:** None

**Response payload:**
```
┌──────────────┬──────────────┬──────────────┬─────────────┐
│ FW_MAJOR (1B)│ FW_MINOR (1B)│ FW_PATCH (1B)│ NAME (32B)  │
└──────────────┴──────────────┴──────────────┴─────────────┘
```

---

### 0x10 - SUBGHZ_CAPTURE

Start capturing Sub-GHz signal.

**Request payload:**
```
┌───────────────┬─────────────┐
│ FREQUENCY (4B)│ TIMEOUT (2B)│
└───────────────┴─────────────┘
```
- FREQUENCY: Hz, little-endian (e.g., 433920000)
- TIMEOUT: Seconds to wait for signal (0 = default 30s)

**Response payload:**
```
┌─────────────┬────────────────┐
│ DATA_LEN(2B)│ RAW_DATA (var) │
└─────────────┴────────────────┘
```

---

### 0x11 - SUBGHZ_TRANSMIT

Transmit a Sub-GHz signal.

**Request payload:**
```
┌───────────────┬─────────────┬────────────────┐
│ FREQUENCY (4B)│ DATA_LEN(2B)│ RAW_DATA (var) │
└───────────────┴─────────────┴────────────────┘
```

**Response payload:** None (status indicates success/failure)

---

### 0x20 - NFC_READ

Read an NFC tag.

**Request payload:**
```
┌─────────────┐
│ TIMEOUT (2B)│
└─────────────┘
```

**Response payload:**
```
┌───────────┬──────────┬──────────────┬────────────────┐
│ TYPE (1B) │ UID_LEN  │ UID (7B max) │ DATA (var)     │
│           │ (1B)     │              │                │
└───────────┴──────────┴──────────────┴────────────────┘
```

NFC Types:
- 0x01: MIFARE Classic
- 0x02: MIFARE Ultralight
- 0x03: NTAG
- 0x04: ISO14443-4

---

### 0x21 - NFC_EMULATE

Emulate an NFC tag.

**Request payload:**
```
┌───────────┬──────────┬──────────────┬────────────────┐
│ TYPE (1B) │ UID_LEN  │ UID (7B max) │ DATA (var)     │
│           │ (1B)     │              │                │
└───────────┴──────────┴──────────────┴────────────────┘
```

**Response payload:** None (emulation runs until next command)

---

### 0x30 - IR_RECEIVE

Capture an IR signal.

**Request payload:**
```
┌─────────────┐
│ TIMEOUT (2B)│
└─────────────┘
```

**Response payload:**
```
┌──────────────┬───────────────┬──────────────────┐
│ PROTOCOL (1B)│ DATA_LEN (2B) │ RAW_TIMINGS (var)│
└──────────────┴───────────────┴──────────────────┘
```

---

### 0x31 - IR_TRANSMIT

Transmit an IR signal.

**Request payload:**
```
┌──────────────┬───────────────┬──────────────────┐
│ PROTOCOL (1B)│ DATA_LEN (2B) │ RAW_TIMINGS (var)│
└──────────────┴───────────────┴──────────────────┘
```

**Response payload:** None

---

### 0x40 - RFID_READ

Read a 125kHz RFID tag.

**Request payload:**
```
┌─────────────┐
│ TIMEOUT (2B)│
└─────────────┘
```

**Response payload:**
```
┌───────────┬────────────────┐
│ TYPE (1B) │ DATA (var)     │
└───────────┴────────────────┘
```

RFID Types:
- 0x01: EM4100
- 0x02: HID Prox
- 0x03: Indala

---

### 0x50 - STORAGE_LIST

List files in a directory.

**Request payload:**
```
┌────────────────────┐
│ PATH (null-term)   │
└────────────────────┘
```

**Response payload:**
```
┌────────────┬─────────────────────────────────────┐
│ COUNT (1B) │ ENTRIES (name + null, repeated)     │
└────────────┴─────────────────────────────────────┘
```

---

### 0x51 - STORAGE_READ

Read a file.

**Request payload:**
```
┌────────────────────┐
│ PATH (null-term)   │
└────────────────────┘
```

**Response payload:**
```
┌─────────────┬────────────────┐
│ SIZE (4B)   │ DATA (var)     │
└─────────────┴────────────────┘
```

---

## Example Exchange

**Request: Get device info**
```
EC        START
00 00     LENGTH (0 bytes payload)
01        SEQ
02        CMD (DEVICE_INFO)
00        STATUS (request)
03        CHECKSUM (00 ^ 00 ^ 01 ^ 02 ^ 00)
```

**Response:**
```
EC        START
23 00     LENGTH (35 bytes)
01        SEQ (matches request)
02        CMD (DEVICE_INFO)
00        STATUS (OK)
01 00 01  FW version 1.0.1
46 6C 69 70 70 65 72 00 ...  "Flipper" + padding
XX        CHECKSUM
```

## Flow Control

1. ESP32 sends request
2. Flipper processes and responds with same SEQ
3. ESP32 can send next request after response received
4. Timeout: 10 seconds for response (30s for capture operations)

## Large Data Handling

For payloads > 1024 bytes (e.g., SubGHz captures), use chunked transfer:

1. First response includes total size in first 4 bytes
2. Subsequent 0x60 (DATA_CONTINUE) commands fetch remaining chunks
3. Each chunk is max 1024 bytes

### 0x60 - DATA_CONTINUE

**Request payload:**
```
┌─────────────┐
│ OFFSET (4B) │
└─────────────┘
```

**Response payload:**
```
┌─────────────┬────────────────┐
│ CHUNK_LEN   │ DATA (var)     │
│ (2B)        │                │
└─────────────┴────────────────┘
```
