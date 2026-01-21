# Ecco Testing Infrastructure

This directory contains testing tools and unit tests for Ecco - The Flipper.

## Quick Start

```bash
# Install dependencies
cd test
npm install

# Run all tests
npm test

# Run specific test suites
npm run test:protocol    # Protocol encoding/decoding tests
npm run test:integration # Integration and mock Flipper tests

# Start mock Flipper server for manual testing
npm run mock-flipper
```

## Components

### 1. Mock Flipper Server (`mock-flipper.js`)

A WebSocket server that emulates the Flipper Zero, allowing you to test the webapp without real hardware.

**Features:**
- Serves the webapp on `http://localhost:8080`
- Handles WebSocket connections on `ws://localhost:8080/ws`
- Responds to all protocol commands with realistic mock data
- Logs all commands for debugging

**Usage:**
```bash
node mock-flipper.js [port]
```

**Mock Data Provided:**
| Command | Mock Response |
|---------|---------------|
| `PING` | Success |
| `DEVICE_INFO` | MockFlipper v0.99.1 |
| `SUBGHZ_CAPTURE` | Simulated OOK signal |
| `NFC_READ` | MIFARE Classic tag (UID: 04:12:34:56) |
| `IR_RECEIVE` | NEC protocol signal |
| `RFID_READ` | EM4100 tag |
| `STORAGE_LIST` | Mock file system |
| `STORAGE_READ` | Sample .sub and .nfc files |

### 2. Protocol Library (`protocol.js`)

JavaScript implementation of the Ecco binary protocol for testing purposes.

**Exports:**
- `buildFrame(cmd, seq, status, payload)` - Build a protocol frame
- `parseFrame(data)` - Parse a protocol frame
- `calculateChecksum(data)` - Calculate XOR checksum
- `encodeUint16LE/32LE` - Little-endian encoding
- `encodeString` - Null-terminated string encoding
- `CMD` - Command constants
- `STATUS` - Status code constants

### 3. Protocol Unit Tests (`protocol.test.js`)

Comprehensive tests for the protocol implementation:
- Checksum calculation
- Frame building and parsing
- Roundtrip encoding/decoding
- Edge cases (empty payloads, max size, etc.)
- Protocol spec compliance

### 4. Integration Tests (`integration.test.js`)

Tests for the mock Flipper and protocol flow:
- All command handlers
- Request/response workflows
- Error handling
- Sequence number matching

## Testing Without Hardware

### Option 1: Mock Flipper Server (Recommended)

1. Start the mock server:
   ```bash
   npm run mock-flipper
   ```

2. Open `http://localhost:8080` in your browser

3. Enter your Anthropic API key and connect

4. Chat with Claude - all hardware operations will return mock data

### Option 2: Unit Tests Only

Run the test suite to verify protocol implementation:
```bash
npm test
```

## Test Coverage

| Area | Coverage |
|------|----------|
| Protocol encoding | Full |
| Protocol decoding | Full |
| Checksum validation | Full |
| All 11 commands | Full |
| Error cases | Full |
| Mock responses | Full |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   Webapp (app.js)                        ││
│  │  - Claude API integration                                ││
│  │  - Tool execution                                        ││
│  │  - WebSocket binary protocol                             ││
│  └──────────────────────┬──────────────────────────────────┘│
└─────────────────────────┼───────────────────────────────────┘
                          │ WebSocket (binary frames)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Mock Flipper Server                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │               mock-flipper.js                            ││
│  │  - HTTP server (serves webapp)                           ││
│  │  - WebSocket server                                      ││
│  │  - Protocol handler                                      ││
│  │  - Mock hardware responses                               ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Adding New Tests

### Protocol Tests

Add tests to `protocol.test.js`:

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildFrame, parseFrame, CMD } from './protocol.js';

describe('My New Test Suite', () => {
    test('does something', () => {
        const frame = buildFrame(CMD.PING, 1);
        assert.ok(frame);
    });
});
```

### Mock Handlers

Add new mock responses in `mock-flipper.js`:

```javascript
// In handleCommand switch
case CMD.NEW_COMMAND:
    return handleNewCommand(seq, payload);

// New handler function
function handleNewCommand(seq, payload) {
    // Generate mock response
    return buildFrame(CMD.NEW_COMMAND, seq, STATUS.OK, responsePayload);
}
```

## Continuous Integration

These tests can be run in CI without hardware:

```yaml
# Example GitHub Actions
- name: Run tests
  run: |
    cd test
    npm install
    npm test
```

## Troubleshooting

### Tests fail with "Cannot find module 'ws'"
```bash
cd test && npm install
```

### Mock server won't start
Check if port 8080 is already in use:
```bash
lsof -i :8080
```

Use a different port:
```bash
node mock-flipper.js 3000
```

### WebSocket connection fails in browser
- Ensure mock server is running
- Check browser console for CORS errors
- Verify you're accessing via `http://localhost:8080`, not `file://`
