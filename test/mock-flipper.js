/**
 * Mock Flipper Zero - WebSocket server that emulates Flipper Zero responses
 *
 * This allows testing the webapp without real hardware.
 *
 * Usage:
 *   node mock-flipper.js [port]
 *
 * Default port is 8080. The server will:
 * - Serve static files from ../webapp on /
 * - Handle WebSocket connections on /ws
 * - Respond to all Ecco protocol commands with mock data
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import {
    FRAME_START,
    CMD,
    STATUS,
    NFC_TYPE,
    RFID_TYPE,
    buildFrame,
    parseFrame,
    encodeUint16LE,
    encodeUint32LE,
    encodeString,
    toHex,
} from './protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.argv[2]) || 8080;
const WEBAPP_DIR = join(__dirname, '..', 'webapp');

// MIME types for static file serving
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

// Mock data for simulated responses
const MOCK_DATA = {
    deviceName: 'MockFlipper',
    firmwareVersion: [0, 99, 1], // 0.99.1

    // Mock SubGHz captured signal (simple OOK pattern)
    subghzSignal: new Uint8Array([
        0x55, 0x55, 0x55, 0x55, // Preamble
        0xAA, 0xBB, 0xCC, 0xDD, // Mock data
        0x12, 0x34, 0x56, 0x78,
    ]),

    // Mock NFC tag
    nfcTag: {
        type: NFC_TYPE.MIFARE_CLASSIC,
        uid: new Uint8Array([0x04, 0x12, 0x34, 0x56]),
        data: new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
    },

    // Mock IR signal (NEC protocol pattern)
    irSignal: {
        protocol: 0x01, // NEC
        data: new Uint8Array([0x00, 0xBF, 0x40, 0x5F]), // Address + Command
    },

    // Mock RFID tag
    rfidTag: {
        type: RFID_TYPE.EM4100,
        data: new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9A]),
    },

    // Mock file system
    files: {
        '/ext': ['subghz', 'nfc', 'infrared', 'rfid', 'badusb'],
        '/ext/subghz': ['garage.sub', 'car_key.sub', 'doorbell.sub'],
        '/ext/nfc': ['work_badge.nfc', 'hotel_key.nfc'],
        '/ext/infrared': ['tv_remote.ir', 'ac_remote.ir'],
    },

    // Mock file contents
    fileContents: {
        '/ext/subghz/garage.sub': `Filetype: Flipper SubGhz RAW File
Version: 1
Frequency: 433920000
Preset: FuriHalSubGhzPresetOok650Async
Protocol: RAW
RAW_Data: 500 -500 500 -500 1000 -1000
`,
        '/ext/nfc/work_badge.nfc': `Filetype: Flipper NFC device
Version: 2
Device type: MIFARE Classic 1K
UID: 04 12 34 56
`,
    },
};

/**
 * Handle incoming protocol commands and generate mock responses
 */
function handleCommand(cmd, seq, payload) {
    console.log(`[Mock] Received command 0x${cmd.toString(16).padStart(2, '0')}, seq=${seq}, payload=${toHex(payload)}`);

    switch (cmd) {
        case CMD.PING:
            return buildFrame(CMD.PING, seq, STATUS.OK);

        case CMD.DEVICE_INFO:
            return handleDeviceInfo(seq);

        case CMD.SUBGHZ_CAPTURE:
            return handleSubghzCapture(seq, payload);

        case CMD.SUBGHZ_TRANSMIT:
            return handleSubghzTransmit(seq, payload);

        case CMD.NFC_READ:
            return handleNfcRead(seq, payload);

        case CMD.NFC_EMULATE:
            return handleNfcEmulate(seq, payload);

        case CMD.IR_RECEIVE:
            return handleIrReceive(seq, payload);

        case CMD.IR_TRANSMIT:
            return handleIrTransmit(seq, payload);

        case CMD.RFID_READ:
            return handleRfidRead(seq, payload);

        case CMD.STORAGE_LIST:
            return handleStorageList(seq, payload);

        case CMD.STORAGE_READ:
            return handleStorageRead(seq, payload);

        default:
            console.log(`[Mock] Unknown command: 0x${cmd.toString(16)}`);
            return buildFrame(cmd, seq, STATUS.ERR_INVALID);
    }
}

function handleDeviceInfo(seq) {
    // Response: FW_MAJOR(1) + FW_MINOR(1) + FW_PATCH(1) + NAME(32)
    const payload = new Uint8Array(35);
    payload[0] = MOCK_DATA.firmwareVersion[0];
    payload[1] = MOCK_DATA.firmwareVersion[1];
    payload[2] = MOCK_DATA.firmwareVersion[2];

    const nameBytes = new TextEncoder().encode(MOCK_DATA.deviceName);
    payload.set(nameBytes, 3);

    console.log(`[Mock] Device info: ${MOCK_DATA.deviceName} v${MOCK_DATA.firmwareVersion.join('.')}`);
    return buildFrame(CMD.DEVICE_INFO, seq, STATUS.OK, payload);
}

function handleSubghzCapture(seq, payload) {
    // Request: FREQUENCY(4) + TIMEOUT(2)
    const view = new DataView(payload.buffer, payload.byteOffset);
    const frequency = view.getUint32(0, true);
    const timeout = view.getUint16(4, true);

    console.log(`[Mock] SubGHz capture at ${frequency / 1000000} MHz, timeout ${timeout}s`);

    // Simulate capture delay
    const signal = MOCK_DATA.subghzSignal;
    const respPayload = new Uint8Array(2 + signal.length);
    respPayload[0] = signal.length & 0xFF;
    respPayload[1] = (signal.length >> 8) & 0xFF;
    respPayload.set(signal, 2);

    return buildFrame(CMD.SUBGHZ_CAPTURE, seq, STATUS.OK, respPayload);
}

function handleSubghzTransmit(seq, payload) {
    // Request: FREQUENCY(4) + DATA_LEN(2) + DATA(var)
    const view = new DataView(payload.buffer, payload.byteOffset);
    const frequency = view.getUint32(0, true);
    const dataLen = view.getUint16(4, true);

    console.log(`[Mock] SubGHz transmit at ${frequency / 1000000} MHz, ${dataLen} bytes`);
    return buildFrame(CMD.SUBGHZ_TRANSMIT, seq, STATUS.OK);
}

function handleNfcRead(seq, payload) {
    // Request: TIMEOUT(2)
    const view = new DataView(payload.buffer, payload.byteOffset);
    const timeout = view.getUint16(0, true);

    console.log(`[Mock] NFC read, timeout ${timeout}s`);

    // Response: TYPE(1) + UID_LEN(1) + UID(var) + DATA(var)
    const tag = MOCK_DATA.nfcTag;
    const respPayload = new Uint8Array(2 + tag.uid.length + tag.data.length);
    respPayload[0] = tag.type;
    respPayload[1] = tag.uid.length;
    respPayload.set(tag.uid, 2);
    respPayload.set(tag.data, 2 + tag.uid.length);

    return buildFrame(CMD.NFC_READ, seq, STATUS.OK, respPayload);
}

function handleNfcEmulate(seq, payload) {
    // Request: TYPE(1) + UID_LEN(1) + UID(var) + DATA(var)
    const type = payload[0];
    const uidLen = payload[1];
    const uid = payload.slice(2, 2 + uidLen);

    console.log(`[Mock] NFC emulate type=${type}, UID=${toHex(uid)}`);
    return buildFrame(CMD.NFC_EMULATE, seq, STATUS.OK);
}

function handleIrReceive(seq, payload) {
    // Request: TIMEOUT(2)
    const view = new DataView(payload.buffer, payload.byteOffset);
    const timeout = view.getUint16(0, true);

    console.log(`[Mock] IR receive, timeout ${timeout}s`);

    // Response: PROTOCOL(1) + DATA_LEN(2) + DATA(var)
    const ir = MOCK_DATA.irSignal;
    const respPayload = new Uint8Array(3 + ir.data.length);
    respPayload[0] = ir.protocol;
    respPayload[1] = ir.data.length & 0xFF;
    respPayload[2] = (ir.data.length >> 8) & 0xFF;
    respPayload.set(ir.data, 3);

    return buildFrame(CMD.IR_RECEIVE, seq, STATUS.OK, respPayload);
}

function handleIrTransmit(seq, payload) {
    // Request: PROTOCOL(1) + DATA_LEN(2) + DATA(var)
    const protocol = payload[0];
    const dataLen = payload[1] | (payload[2] << 8);

    console.log(`[Mock] IR transmit protocol=${protocol}, ${dataLen} bytes`);
    return buildFrame(CMD.IR_TRANSMIT, seq, STATUS.OK);
}

function handleRfidRead(seq, payload) {
    // Request: TIMEOUT(2)
    const view = new DataView(payload.buffer, payload.byteOffset);
    const timeout = view.getUint16(0, true);

    console.log(`[Mock] RFID read, timeout ${timeout}s`);

    // Response: TYPE(1) + DATA(var)
    const tag = MOCK_DATA.rfidTag;
    const respPayload = new Uint8Array(1 + tag.data.length);
    respPayload[0] = tag.type;
    respPayload.set(tag.data, 1);

    return buildFrame(CMD.RFID_READ, seq, STATUS.OK, respPayload);
}

function handleStorageList(seq, payload) {
    // Request: PATH(null-term)
    const decoder = new TextDecoder();
    let path = decoder.decode(payload).replace(/\0/g, '');

    console.log(`[Mock] Storage list: ${path}`);

    const files = MOCK_DATA.files[path];
    if (!files) {
        return buildFrame(CMD.STORAGE_LIST, seq, STATUS.ERR_NOT_FOUND);
    }

    // Response: COUNT(1) + ENTRIES(name + null, repeated)
    const entries = files.map(f => encodeString(f));
    const totalLen = 1 + entries.reduce((sum, e) => sum + e.length, 0);
    const respPayload = new Uint8Array(totalLen);
    respPayload[0] = files.length;

    let offset = 1;
    for (const entry of entries) {
        respPayload.set(entry, offset);
        offset += entry.length;
    }

    return buildFrame(CMD.STORAGE_LIST, seq, STATUS.OK, respPayload);
}

function handleStorageRead(seq, payload) {
    // Request: PATH(null-term)
    const decoder = new TextDecoder();
    let path = decoder.decode(payload).replace(/\0/g, '');

    console.log(`[Mock] Storage read: ${path}`);

    const content = MOCK_DATA.fileContents[path];
    if (!content) {
        return buildFrame(CMD.STORAGE_READ, seq, STATUS.ERR_NOT_FOUND);
    }

    // Response: SIZE(4) + DATA(var)
    const contentBytes = new TextEncoder().encode(content);
    const respPayload = new Uint8Array(4 + contentBytes.length);
    const view = new DataView(respPayload.buffer);
    view.setUint32(0, contentBytes.length, true);
    respPayload.set(contentBytes, 4);

    return buildFrame(CMD.STORAGE_READ, seq, STATUS.OK, respPayload);
}

/**
 * Start the mock server
 */
function startServer() {
    const server = createServer((req, res) => {
        // Serve static files from webapp directory
        let filePath = req.url === '/' ? '/index.html' : req.url;
        filePath = join(WEBAPP_DIR, filePath);

        if (!existsSync(filePath)) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        try {
            const content = readFileSync(filePath);
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        } catch (err) {
            res.writeHead(500);
            res.end('Internal server error');
        }
    });

    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws) => {
        console.log('[Mock] Client connected');

        ws.on('message', (data) => {
            try {
                const buf = new Uint8Array(data);
                const frame = parseFrame(buf);

                if (frame) {
                    const response = handleCommand(frame.cmd, frame.seq, frame.payload);
                    ws.send(response);
                    console.log(`[Mock] Sent response: ${toHex(response)}`);
                }
            } catch (err) {
                console.error('[Mock] Error processing frame:', err.message);
            }
        });

        ws.on('close', () => {
            console.log('[Mock] Client disconnected');
        });

        ws.on('error', (err) => {
            console.error('[Mock] WebSocket error:', err.message);
        });
    });

    server.listen(PORT, () => {
        console.log(`
╔═══════════════════════════════════════════════════════════╗
║           Mock Flipper Zero Server Started                ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║   Web UI:     http://localhost:${PORT.toString().padEnd(27)}║
║   WebSocket:  ws://localhost:${PORT}/ws${' '.repeat(24)}║
║                                                           ║
║   This emulates a Flipper Zero for testing.               ║
║   All hardware operations return mock data.               ║
║                                                           ║
║   Available mock responses:                               ║
║   - Device info: MockFlipper v0.99.1                      ║
║   - SubGHz: Simulated OOK signal capture                  ║
║   - NFC: MIFARE Classic tag (UID: 04:12:34:56)            ║
║   - IR: NEC protocol signal                               ║
║   - RFID: EM4100 tag                                      ║
║   - Storage: Mock file system                             ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);
    });
}

// Export for testing
export { handleCommand, MOCK_DATA };

// Run server if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    startServer();
}
