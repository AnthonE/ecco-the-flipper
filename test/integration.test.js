/**
 * Integration Tests
 *
 * Tests for the mock Flipper server and end-to-end protocol flow.
 * Run with: node --test integration.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { WebSocket } from 'ws';

import {
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

import { handleCommand, MOCK_DATA } from './mock-flipper.js';

describe('Mock Flipper Command Handlers', () => {
    test('handles PING command', () => {
        const response = handleCommand(CMD.PING, 1, new Uint8Array());
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.PING);
        assert.strictEqual(parsed.status, STATUS.OK);
        assert.strictEqual(parsed.seq, 1);
    });

    test('handles DEVICE_INFO command', () => {
        const response = handleCommand(CMD.DEVICE_INFO, 5, new Uint8Array());
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.DEVICE_INFO);
        assert.strictEqual(parsed.status, STATUS.OK);
        assert.strictEqual(parsed.seq, 5);

        // Check firmware version
        assert.strictEqual(parsed.payload[0], MOCK_DATA.firmwareVersion[0]);
        assert.strictEqual(parsed.payload[1], MOCK_DATA.firmwareVersion[1]);
        assert.strictEqual(parsed.payload[2], MOCK_DATA.firmwareVersion[2]);

        // Check device name
        const name = new TextDecoder().decode(parsed.payload.slice(3)).replace(/\0/g, '');
        assert.strictEqual(name, MOCK_DATA.deviceName);
    });

    test('handles SUBGHZ_CAPTURE command', () => {
        const payload = new Uint8Array(6);
        const view = new DataView(payload.buffer);
        view.setUint32(0, 433920000, true); // Frequency
        view.setUint16(4, 30, true); // Timeout

        const response = handleCommand(CMD.SUBGHZ_CAPTURE, 10, payload);
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.SUBGHZ_CAPTURE);
        assert.strictEqual(parsed.status, STATUS.OK);

        // Check response has data
        const dataLen = parsed.payload[0] | (parsed.payload[1] << 8);
        assert.ok(dataLen > 0, 'Should have captured data');
    });

    test('handles SUBGHZ_TRANSMIT command', () => {
        const data = new Uint8Array([0x55, 0xAA, 0x55, 0xAA]);
        const payload = new Uint8Array(6 + data.length);
        const view = new DataView(payload.buffer);
        view.setUint32(0, 433920000, true);
        view.setUint16(4, data.length, true);
        payload.set(data, 6);

        const response = handleCommand(CMD.SUBGHZ_TRANSMIT, 11, payload);
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.SUBGHZ_TRANSMIT);
        assert.strictEqual(parsed.status, STATUS.OK);
    });

    test('handles NFC_READ command', () => {
        const payload = encodeUint16LE(30); // Timeout

        const response = handleCommand(CMD.NFC_READ, 20, payload);
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.NFC_READ);
        assert.strictEqual(parsed.status, STATUS.OK);

        // Check NFC data structure
        assert.strictEqual(parsed.payload[0], MOCK_DATA.nfcTag.type);
        assert.strictEqual(parsed.payload[1], MOCK_DATA.nfcTag.uid.length);
    });

    test('handles NFC_EMULATE command', () => {
        const uid = new Uint8Array([0x04, 0x12, 0x34, 0x56]);
        const payload = new Uint8Array(2 + uid.length);
        payload[0] = NFC_TYPE.MIFARE_CLASSIC;
        payload[1] = uid.length;
        payload.set(uid, 2);

        const response = handleCommand(CMD.NFC_EMULATE, 21, payload);
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.NFC_EMULATE);
        assert.strictEqual(parsed.status, STATUS.OK);
    });

    test('handles IR_RECEIVE command', () => {
        const payload = encodeUint16LE(30);

        const response = handleCommand(CMD.IR_RECEIVE, 30, payload);
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.IR_RECEIVE);
        assert.strictEqual(parsed.status, STATUS.OK);

        // Check IR data structure (protocol + length + data)
        assert.ok(parsed.payload.length >= 3);
    });

    test('handles IR_TRANSMIT command', () => {
        const data = new Uint8Array([0x00, 0xBF, 0x40, 0x5F]);
        const payload = new Uint8Array(3 + data.length);
        payload[0] = 0x01; // Protocol
        payload[1] = data.length & 0xFF;
        payload[2] = (data.length >> 8) & 0xFF;
        payload.set(data, 3);

        const response = handleCommand(CMD.IR_TRANSMIT, 31, payload);
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.IR_TRANSMIT);
        assert.strictEqual(parsed.status, STATUS.OK);
    });

    test('handles RFID_READ command', () => {
        const payload = encodeUint16LE(30);

        const response = handleCommand(CMD.RFID_READ, 40, payload);
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.RFID_READ);
        assert.strictEqual(parsed.status, STATUS.OK);

        // Check RFID data structure
        assert.strictEqual(parsed.payload[0], MOCK_DATA.rfidTag.type);
    });

    test('handles STORAGE_LIST command', () => {
        const payload = encodeString('/ext');

        const response = handleCommand(CMD.STORAGE_LIST, 50, payload);
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.STORAGE_LIST);
        assert.strictEqual(parsed.status, STATUS.OK);

        // Check file list
        const count = parsed.payload[0];
        assert.strictEqual(count, MOCK_DATA.files['/ext'].length);
    });

    test('handles STORAGE_LIST for nonexistent path', () => {
        const payload = encodeString('/nonexistent');

        const response = handleCommand(CMD.STORAGE_LIST, 51, payload);
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.STORAGE_LIST);
        assert.strictEqual(parsed.status, STATUS.ERR_NOT_FOUND);
    });

    test('handles STORAGE_READ command', () => {
        const payload = encodeString('/ext/subghz/garage.sub');

        const response = handleCommand(CMD.STORAGE_READ, 52, payload);
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.STORAGE_READ);
        assert.strictEqual(parsed.status, STATUS.OK);

        // Check file content
        const size = parsed.payload[0] | (parsed.payload[1] << 8) |
            (parsed.payload[2] << 16) | (parsed.payload[3] << 24);
        assert.ok(size > 0);
    });

    test('handles STORAGE_READ for nonexistent file', () => {
        const payload = encodeString('/ext/nonexistent.txt');

        const response = handleCommand(CMD.STORAGE_READ, 53, payload);
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, CMD.STORAGE_READ);
        assert.strictEqual(parsed.status, STATUS.ERR_NOT_FOUND);
    });

    test('handles unknown command', () => {
        const response = handleCommand(0xFF, 99, new Uint8Array());
        const parsed = parseFrame(response);

        assert.strictEqual(parsed.cmd, 0xFF);
        assert.strictEqual(parsed.status, STATUS.ERR_INVALID);
    });
});

describe('Protocol Flow Simulation', () => {
    test('simulates complete device info request/response', () => {
        // Build request
        const request = buildFrame(CMD.DEVICE_INFO, 1, STATUS.OK);

        // Parse it (simulating what Flipper receives)
        const requestParsed = parseFrame(request);
        assert.strictEqual(requestParsed.cmd, CMD.DEVICE_INFO);

        // Generate response (simulating Flipper)
        const response = handleCommand(requestParsed.cmd, requestParsed.seq, requestParsed.payload);

        // Parse response (simulating what browser receives)
        const responseParsed = parseFrame(response);

        assert.strictEqual(responseParsed.cmd, CMD.DEVICE_INFO);
        assert.strictEqual(responseParsed.status, STATUS.OK);
        assert.strictEqual(responseParsed.seq, 1);
    });

    test('simulates SubGHz capture workflow', () => {
        // Step 1: Send capture request
        const capturePayload = new Uint8Array(6);
        new DataView(capturePayload.buffer).setUint32(0, 433920000, true);
        new DataView(capturePayload.buffer).setUint16(4, 30, true);

        const captureRequest = buildFrame(CMD.SUBGHZ_CAPTURE, 1, STATUS.OK, capturePayload);
        const captureReqParsed = parseFrame(captureRequest);

        const captureResponse = handleCommand(captureReqParsed.cmd, captureReqParsed.seq, captureReqParsed.payload);
        const captureRespParsed = parseFrame(captureResponse);

        assert.strictEqual(captureRespParsed.status, STATUS.OK);

        // Extract captured data
        const dataLen = captureRespParsed.payload[0] | (captureRespParsed.payload[1] << 8);
        const capturedData = captureRespParsed.payload.slice(2, 2 + dataLen);

        // Step 2: Transmit the captured signal
        const transmitPayload = new Uint8Array(6 + capturedData.length);
        new DataView(transmitPayload.buffer).setUint32(0, 433920000, true);
        new DataView(transmitPayload.buffer).setUint16(4, capturedData.length, true);
        transmitPayload.set(capturedData, 6);

        const transmitRequest = buildFrame(CMD.SUBGHZ_TRANSMIT, 2, STATUS.OK, transmitPayload);
        const transmitReqParsed = parseFrame(transmitRequest);

        const transmitResponse = handleCommand(transmitReqParsed.cmd, transmitReqParsed.seq, transmitReqParsed.payload);
        const transmitRespParsed = parseFrame(transmitResponse);

        assert.strictEqual(transmitRespParsed.status, STATUS.OK);
    });

    test('simulates NFC read and emulate workflow', () => {
        // Step 1: Read NFC tag
        const readPayload = encodeUint16LE(30);
        const readRequest = buildFrame(CMD.NFC_READ, 1, STATUS.OK, readPayload);
        const readReqParsed = parseFrame(readRequest);

        const readResponse = handleCommand(readReqParsed.cmd, readReqParsed.seq, readReqParsed.payload);
        const readRespParsed = parseFrame(readResponse);

        assert.strictEqual(readRespParsed.status, STATUS.OK);

        // Extract tag data
        const type = readRespParsed.payload[0];
        const uidLen = readRespParsed.payload[1];
        const uid = readRespParsed.payload.slice(2, 2 + uidLen);
        const data = readRespParsed.payload.slice(2 + uidLen);

        // Step 2: Emulate the read tag
        const emulatePayload = new Uint8Array(2 + uid.length + data.length);
        emulatePayload[0] = type;
        emulatePayload[1] = uid.length;
        emulatePayload.set(uid, 2);
        emulatePayload.set(data, 2 + uid.length);

        const emulateRequest = buildFrame(CMD.NFC_EMULATE, 2, STATUS.OK, emulatePayload);
        const emulateReqParsed = parseFrame(emulateRequest);

        const emulateResponse = handleCommand(emulateReqParsed.cmd, emulateReqParsed.seq, emulateReqParsed.payload);
        const emulateRespParsed = parseFrame(emulateResponse);

        assert.strictEqual(emulateRespParsed.status, STATUS.OK);
    });

    test('simulates storage navigation', () => {
        // List root directory
        const listRootReq = buildFrame(CMD.STORAGE_LIST, 1, STATUS.OK, encodeString('/ext'));
        const listRootParsed = parseFrame(listRootReq);
        const listRootResp = handleCommand(listRootParsed.cmd, listRootParsed.seq, listRootParsed.payload);
        const listRootRespParsed = parseFrame(listRootResp);

        assert.strictEqual(listRootRespParsed.status, STATUS.OK);
        const rootCount = listRootRespParsed.payload[0];
        assert.ok(rootCount > 0, 'Should have files in /ext');

        // List subghz directory
        const listSubReq = buildFrame(CMD.STORAGE_LIST, 2, STATUS.OK, encodeString('/ext/subghz'));
        const listSubParsed = parseFrame(listSubReq);
        const listSubResp = handleCommand(listSubParsed.cmd, listSubParsed.seq, listSubParsed.payload);
        const listSubRespParsed = parseFrame(listSubResp);

        assert.strictEqual(listSubRespParsed.status, STATUS.OK);

        // Read a file
        const readReq = buildFrame(CMD.STORAGE_READ, 3, STATUS.OK, encodeString('/ext/subghz/garage.sub'));
        const readParsed = parseFrame(readReq);
        const readResp = handleCommand(readParsed.cmd, readParsed.seq, readParsed.payload);
        const readRespParsed = parseFrame(readResp);

        assert.strictEqual(readRespParsed.status, STATUS.OK);
    });
});

describe('Sequence Number Handling', () => {
    test('response sequence matches request', () => {
        for (let seq = 0; seq < 256; seq += 17) {
            const response = handleCommand(CMD.PING, seq, new Uint8Array());
            const parsed = parseFrame(response);
            assert.strictEqual(parsed.seq, seq);
        }
    });
});

describe('Error Handling', () => {
    test('returns ERR_NOT_FOUND for missing storage paths', () => {
        const paths = ['/nonexistent', '/ext/missing', '/ext/subghz/nofile.sub'];

        for (const path of paths) {
            const response = handleCommand(CMD.STORAGE_LIST, 1, encodeString(path));
            const parsed = parseFrame(response);
            assert.strictEqual(parsed.status, STATUS.ERR_NOT_FOUND);
        }
    });

    test('returns ERR_INVALID for unknown commands', () => {
        const unknownCmds = [0x00, 0x03, 0x99, 0xFF];

        for (const cmd of unknownCmds) {
            const response = handleCommand(cmd, 1, new Uint8Array());
            const parsed = parseFrame(response);
            assert.strictEqual(parsed.status, STATUS.ERR_INVALID);
        }
    });
});

describe('Mock Data Integrity', () => {
    test('mock SubGHz signal is valid', () => {
        assert.ok(MOCK_DATA.subghzSignal instanceof Uint8Array);
        assert.ok(MOCK_DATA.subghzSignal.length > 0);
    });

    test('mock NFC tag has required fields', () => {
        assert.ok(typeof MOCK_DATA.nfcTag.type === 'number');
        assert.ok(MOCK_DATA.nfcTag.uid instanceof Uint8Array);
        assert.ok(MOCK_DATA.nfcTag.uid.length > 0 && MOCK_DATA.nfcTag.uid.length <= 7);
    });

    test('mock IR signal has required fields', () => {
        assert.ok(typeof MOCK_DATA.irSignal.protocol === 'number');
        assert.ok(MOCK_DATA.irSignal.data instanceof Uint8Array);
    });

    test('mock RFID tag has required fields', () => {
        assert.ok(typeof MOCK_DATA.rfidTag.type === 'number');
        assert.ok(MOCK_DATA.rfidTag.data instanceof Uint8Array);
    });

    test('mock file system structure is valid', () => {
        assert.ok(typeof MOCK_DATA.files === 'object');
        assert.ok(Array.isArray(MOCK_DATA.files['/ext']));
        assert.ok(typeof MOCK_DATA.fileContents === 'object');
    });
});
