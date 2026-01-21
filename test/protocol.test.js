/**
 * Protocol Unit Tests
 *
 * Tests for the Ecco binary protocol implementation.
 * Run with: node --test protocol.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
    FRAME_START,
    MAX_PAYLOAD,
    CMD,
    STATUS,
    calculateChecksum,
    buildFrame,
    parseFrame,
    toBytes,
    toHex,
    encodeUint16LE,
    encodeUint32LE,
    decodeUint16LE,
    decodeUint32LE,
    encodeString,
    decodeString,
} from './protocol.js';

describe('Checksum', () => {
    test('calculates XOR checksum correctly', () => {
        const data = new Uint8Array([0x00, 0x00, 0x01, 0x02, 0x00]);
        const checksum = calculateChecksum(data);
        assert.strictEqual(checksum, 0x03); // 0x00 ^ 0x00 ^ 0x01 ^ 0x02 ^ 0x00 = 0x03
    });

    test('checksum of empty array is 0', () => {
        const checksum = calculateChecksum(new Uint8Array());
        assert.strictEqual(checksum, 0);
    });

    test('checksum of single byte is the byte itself', () => {
        const checksum = calculateChecksum(new Uint8Array([0x42]));
        assert.strictEqual(checksum, 0x42);
    });

    test('checksum of identical bytes pairs to 0', () => {
        const checksum = calculateChecksum(new Uint8Array([0xAA, 0xAA]));
        assert.strictEqual(checksum, 0);
    });
});

describe('Frame Building', () => {
    test('builds minimal frame (no payload)', () => {
        const frame = buildFrame(CMD.PING, 1, STATUS.OK);

        assert.strictEqual(frame[0], FRAME_START);
        assert.strictEqual(frame[1], 0x00); // Length low
        assert.strictEqual(frame[2], 0x00); // Length high
        assert.strictEqual(frame[3], 0x01); // Seq
        assert.strictEqual(frame[4], CMD.PING);
        assert.strictEqual(frame[5], STATUS.OK);
        assert.strictEqual(frame.length, 7);

        // Verify checksum
        const expectedChecksum = calculateChecksum(frame.slice(1, 6));
        assert.strictEqual(frame[6], expectedChecksum);
    });

    test('builds frame with payload', () => {
        const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
        const frame = buildFrame(CMD.DEVICE_INFO, 5, STATUS.OK, payload);

        assert.strictEqual(frame[0], FRAME_START);
        assert.strictEqual(frame[1], 0x04); // Length low
        assert.strictEqual(frame[2], 0x00); // Length high
        assert.strictEqual(frame[3], 0x05); // Seq
        assert.strictEqual(frame[4], CMD.DEVICE_INFO);
        assert.strictEqual(frame[5], STATUS.OK);
        assert.deepStrictEqual(Array.from(frame.slice(6, 10)), [0x01, 0x02, 0x03, 0x04]);
        assert.strictEqual(frame.length, 11);
    });

    test('sequence number wraps at 255', () => {
        const frame = buildFrame(CMD.PING, 256, STATUS.OK);
        assert.strictEqual(frame[3], 0x00); // 256 & 0xFF = 0
    });

    test('handles large payload (up to MAX_PAYLOAD)', () => {
        const payload = new Uint8Array(MAX_PAYLOAD);
        payload.fill(0xAB);

        const frame = buildFrame(CMD.STORAGE_READ, 1, STATUS.OK, payload);

        // Length should be 1024 (0x0400 little-endian)
        assert.strictEqual(frame[1], 0x00);
        assert.strictEqual(frame[2], 0x04);
        assert.strictEqual(frame.length, 7 + MAX_PAYLOAD);
    });

    test('rejects payload exceeding MAX_PAYLOAD', () => {
        const payload = new Uint8Array(MAX_PAYLOAD + 1);

        assert.throws(() => {
            buildFrame(CMD.PING, 1, STATUS.OK, payload);
        }, /Payload too large/);
    });

    test('builds DEVICE_INFO request matching protocol spec example', () => {
        // From protocol spec:
        // EC 00 00 01 02 00 03
        const frame = buildFrame(CMD.DEVICE_INFO, 1, STATUS.OK);

        assert.strictEqual(toHex(frame), 'ec 00 00 01 02 00 03');
    });
});

describe('Frame Parsing', () => {
    test('parses minimal frame', () => {
        const data = toBytes('ec 00 00 01 01 00 00');
        const frame = parseFrame(data);

        assert.strictEqual(frame.seq, 1);
        assert.strictEqual(frame.cmd, CMD.PING);
        assert.strictEqual(frame.status, STATUS.OK);
        assert.strictEqual(frame.payload.length, 0);
        assert.strictEqual(frame.frameLength, 7);
    });

    test('parses frame with payload', () => {
        // Build a frame and then parse it
        const original = buildFrame(CMD.DEVICE_INFO, 42, STATUS.OK, new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]));
        const parsed = parseFrame(original);

        assert.strictEqual(parsed.seq, 42);
        assert.strictEqual(parsed.cmd, CMD.DEVICE_INFO);
        assert.strictEqual(parsed.status, STATUS.OK);
        assert.deepStrictEqual(Array.from(parsed.payload), [0xDE, 0xAD, 0xBE, 0xEF]);
    });

    test('returns null for incomplete frame', () => {
        const data = toBytes('ec 00 00'); // Only 3 bytes
        const frame = parseFrame(data);

        assert.strictEqual(frame, null);
    });

    test('returns null when payload is incomplete', () => {
        // Header says 4 bytes payload, but only 2 provided
        const data = toBytes('ec 04 00 01 01 00 aa bb');
        const frame = parseFrame(data);

        assert.strictEqual(frame, null);
    });

    test('throws on invalid start byte', () => {
        const data = toBytes('ab 00 00 01 01 00 00');

        assert.throws(() => {
            parseFrame(data);
        }, /Invalid frame start/);
    });

    test('throws on payload too large', () => {
        // Length = 0x0500 = 1280, which exceeds MAX_PAYLOAD (1024)
        // Need at least 7 bytes for parseFrame to read the header
        const data = toBytes('ec 00 05 01 01 00 00');

        assert.throws(() => {
            parseFrame(data);
        }, /Payload too large/);
    });

    test('throws on checksum mismatch', () => {
        const data = toBytes('ec 00 00 01 01 00 ff'); // Wrong checksum

        assert.throws(() => {
            parseFrame(data);
        }, /Checksum mismatch/);
    });

    test('handles ArrayBuffer input', () => {
        const bytes = toBytes('ec 00 00 01 01 00 00');
        const buffer = bytes.buffer;
        const frame = parseFrame(buffer);

        assert.strictEqual(frame.cmd, CMD.PING);
    });
});

describe('Roundtrip', () => {
    test('build and parse are inverse operations', () => {
        for (const cmd of Object.values(CMD)) {
            for (const status of Object.values(STATUS)) {
                const payload = new Uint8Array(16);
                crypto.getRandomValues(payload);
                const seq = Math.floor(Math.random() * 256);

                const frame = buildFrame(cmd, seq, status, payload);
                const parsed = parseFrame(frame);

                assert.strictEqual(parsed.cmd, cmd, `cmd mismatch for 0x${cmd.toString(16)}`);
                assert.strictEqual(parsed.status, status);
                assert.strictEqual(parsed.seq, seq);
                assert.deepStrictEqual(Array.from(parsed.payload), Array.from(payload));
            }
        }
    });

    test('handles all edge case payloads', () => {
        const testCases = [
            new Uint8Array([]), // Empty
            new Uint8Array([0x00]), // Single zero
            new Uint8Array([0xFF]), // Single max
            new Uint8Array(256).fill(0xAA), // Medium
            new Uint8Array(MAX_PAYLOAD).fill(0x55), // Max size
        ];

        for (const payload of testCases) {
            const frame = buildFrame(CMD.PING, 0, STATUS.OK, payload);
            const parsed = parseFrame(frame);

            assert.deepStrictEqual(
                Array.from(parsed.payload),
                Array.from(payload),
                `Payload size ${payload.length} failed roundtrip`
            );
        }
    });
});

describe('Encoding Helpers', () => {
    test('encodeUint16LE encodes correctly', () => {
        assert.deepStrictEqual(Array.from(encodeUint16LE(0x0000)), [0x00, 0x00]);
        assert.deepStrictEqual(Array.from(encodeUint16LE(0x0001)), [0x01, 0x00]);
        assert.deepStrictEqual(Array.from(encodeUint16LE(0x0100)), [0x00, 0x01]);
        assert.deepStrictEqual(Array.from(encodeUint16LE(0x1234)), [0x34, 0x12]);
        assert.deepStrictEqual(Array.from(encodeUint16LE(0xFFFF)), [0xFF, 0xFF]);
    });

    test('encodeUint32LE encodes correctly', () => {
        assert.deepStrictEqual(Array.from(encodeUint32LE(0x00000000)), [0x00, 0x00, 0x00, 0x00]);
        assert.deepStrictEqual(Array.from(encodeUint32LE(0x12345678)), [0x78, 0x56, 0x34, 0x12]);
        assert.deepStrictEqual(Array.from(encodeUint32LE(433920000)), [0x00, 0x18, 0xDD, 0x19]); // 433.92 MHz
    });

    test('decodeUint16LE decodes correctly', () => {
        assert.strictEqual(decodeUint16LE(new Uint8Array([0x00, 0x00])), 0x0000);
        assert.strictEqual(decodeUint16LE(new Uint8Array([0x34, 0x12])), 0x1234);
        assert.strictEqual(decodeUint16LE(new Uint8Array([0xFF, 0xFF])), 0xFFFF);
    });

    test('decodeUint32LE decodes correctly', () => {
        assert.strictEqual(decodeUint32LE(new Uint8Array([0x00, 0x00, 0x00, 0x00])), 0x00000000);
        assert.strictEqual(decodeUint32LE(new Uint8Array([0x78, 0x56, 0x34, 0x12])), 0x12345678);
        assert.strictEqual(decodeUint32LE(new Uint8Array([0x00, 0x18, 0xDD, 0x19])), 433920000); // 433.92 MHz
    });

    test('uint16 roundtrip', () => {
        for (const val of [0, 1, 255, 256, 1000, 65535]) {
            const encoded = encodeUint16LE(val);
            const decoded = decodeUint16LE(encoded);
            assert.strictEqual(decoded, val);
        }
    });

    test('uint32 roundtrip', () => {
        for (const val of [0, 1, 65535, 65536, 433920000, 0xFFFFFFFF]) {
            const encoded = encodeUint32LE(val);
            const decoded = decodeUint32LE(encoded);
            assert.strictEqual(decoded >>> 0, val >>> 0); // Handle sign
        }
    });
});

describe('String Encoding', () => {
    test('encodeString adds null terminator', () => {
        const encoded = encodeString('hello');
        assert.deepStrictEqual(
            Array.from(encoded),
            [0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00]
        );
    });

    test('encodeString handles empty string', () => {
        const encoded = encodeString('');
        assert.deepStrictEqual(Array.from(encoded), [0x00]);
    });

    test('decodeString reads until null', () => {
        const data = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0xFF, 0xFF]);
        const result = decodeString(data);

        assert.strictEqual(result.value, 'hello');
        assert.strictEqual(result.length, 6); // Including null terminator
    });

    test('decodeString with offset', () => {
        const data = new Uint8Array([0xFF, 0xFF, 0x68, 0x69, 0x00, 0xFF]);
        const result = decodeString(data, 2);

        assert.strictEqual(result.value, 'hi');
        assert.strictEqual(result.length, 3);
    });

    test('string roundtrip', () => {
        const testStrings = ['', 'a', 'hello', '/ext/subghz/garage.sub', 'Unicode: '];
        for (const str of testStrings) {
            const encoded = encodeString(str);
            const decoded = decodeString(encoded);
            assert.strictEqual(decoded.value, str);
        }
    });
});

describe('Byte Conversion Helpers', () => {
    test('toBytes parses hex string', () => {
        const bytes = toBytes('EC 00 00 01 02 00 03');
        assert.deepStrictEqual(
            Array.from(bytes),
            [0xEC, 0x00, 0x00, 0x01, 0x02, 0x00, 0x03]
        );
    });

    test('toBytes handles lowercase and no spaces', () => {
        const bytes = toBytes('ec0000010200');
        assert.deepStrictEqual(
            Array.from(bytes),
            [0xEC, 0x00, 0x00, 0x01, 0x02, 0x00]
        );
    });

    test('toBytes handles array input', () => {
        const bytes = toBytes([0xEC, 0x00, 0x00]);
        assert.deepStrictEqual(Array.from(bytes), [0xEC, 0x00, 0x00]);
    });

    test('toHex formats bytes correctly', () => {
        const hex = toHex(new Uint8Array([0xEC, 0x00, 0x00, 0x01]));
        assert.strictEqual(hex, 'ec 00 00 01');
    });
});

describe('Protocol Spec Compliance', () => {
    test('DEVICE_INFO request matches spec example', () => {
        // From spec: EC 00 00 01 02 00 03
        const frame = buildFrame(CMD.DEVICE_INFO, 1, STATUS.OK);
        assert.strictEqual(toHex(frame), 'ec 00 00 01 02 00 03');
    });

    test('frame format matches spec structure', () => {
        const payload = new Uint8Array([0x11, 0x22]);
        const frame = buildFrame(0x99, 0x55, 0x00, payload);

        // Verify structure: START(1) + LENGTH(2) + SEQ(1) + CMD(1) + STATUS(1) + PAYLOAD(var) + CHECKSUM(1)
        assert.strictEqual(frame[0], FRAME_START); // START
        assert.strictEqual(decodeUint16LE(frame, 1), 2); // LENGTH
        assert.strictEqual(frame[3], 0x55); // SEQ
        assert.strictEqual(frame[4], 0x99); // CMD
        assert.strictEqual(frame[5], 0x00); // STATUS
        assert.deepStrictEqual(Array.from(frame.slice(6, 8)), [0x11, 0x22]); // PAYLOAD
        // CHECKSUM at frame[8]
    });

    test('all command IDs are defined', () => {
        const expectedCommands = {
            PING: 0x01,
            DEVICE_INFO: 0x02,
            SUBGHZ_CAPTURE: 0x10,
            SUBGHZ_TRANSMIT: 0x11,
            NFC_READ: 0x20,
            NFC_EMULATE: 0x21,
            IR_RECEIVE: 0x30,
            IR_TRANSMIT: 0x31,
            RFID_READ: 0x40,
            STORAGE_LIST: 0x50,
            STORAGE_READ: 0x51,
            DATA_CONTINUE: 0x60,
        };

        for (const [name, value] of Object.entries(expectedCommands)) {
            assert.strictEqual(CMD[name], value, `CMD.${name} should be 0x${value.toString(16)}`);
        }
    });

    test('all status codes are defined', () => {
        const expectedStatus = {
            OK: 0x00,
            ERR_UNKNOWN: 0x01,
            ERR_INVALID: 0x02,
            ERR_BUSY: 0x03,
            ERR_TIMEOUT: 0x04,
            ERR_NOT_FOUND: 0x05,
            ERR_NO_DATA: 0x06,
        };

        for (const [name, value] of Object.entries(expectedStatus)) {
            assert.strictEqual(STATUS[name], value, `STATUS.${name} should be 0x${value.toString(16)}`);
        }
    });
});
