/**
 * Ecco Protocol - JavaScript implementation for testing
 *
 * This module implements the binary protocol used by Ecco for communication
 * between the browser, ESP32, and Flipper Zero.
 */

export const FRAME_START = 0xEC;
export const MAX_PAYLOAD = 1024;

// Command IDs
export const CMD = {
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

// Status codes
export const STATUS = {
    OK: 0x00,
    ERR_UNKNOWN: 0x01,
    ERR_INVALID: 0x02,
    ERR_BUSY: 0x03,
    ERR_TIMEOUT: 0x04,
    ERR_NOT_FOUND: 0x05,
    ERR_NO_DATA: 0x06,
};

// NFC types
export const NFC_TYPE = {
    MIFARE_CLASSIC: 0x01,
    MIFARE_ULTRALIGHT: 0x02,
    NTAG: 0x03,
    ISO14443_4: 0x04,
};

// RFID types
export const RFID_TYPE = {
    EM4100: 0x01,
    HID_PROX: 0x02,
    INDALA: 0x03,
};

/**
 * Calculate XOR checksum of data
 * @param {Uint8Array} data - Data to checksum
 * @returns {number} XOR checksum byte
 */
export function calculateChecksum(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum ^= data[i];
    }
    return sum;
}

/**
 * Build a protocol frame
 * @param {number} cmd - Command ID
 * @param {number} seq - Sequence number
 * @param {number} status - Status code (0x00 for requests)
 * @param {Uint8Array} payload - Payload data
 * @returns {Uint8Array} Complete frame
 */
export function buildFrame(cmd, seq, status = 0x00, payload = new Uint8Array()) {
    if (payload.length > MAX_PAYLOAD) {
        throw new Error(`Payload too large: ${payload.length} > ${MAX_PAYLOAD}`);
    }

    const len = payload.length;
    const frame = new Uint8Array(7 + len);

    frame[0] = FRAME_START;
    frame[1] = len & 0xFF;
    frame[2] = (len >> 8) & 0xFF;
    frame[3] = seq & 0xFF;
    frame[4] = cmd;
    frame[5] = status;

    if (len > 0) {
        frame.set(payload, 6);
    }

    // Checksum: XOR of bytes 1 to end-1
    frame[frame.length - 1] = calculateChecksum(frame.slice(1, frame.length - 1));

    return frame;
}

/**
 * Parse a protocol frame
 * @param {Uint8Array|ArrayBuffer} data - Raw frame data
 * @returns {Object|null} Parsed frame or null if incomplete
 * @throws {Error} If frame is invalid
 */
export function parseFrame(data) {
    const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : data;

    // Need at least 7 bytes
    if (buf.length < 7) {
        return null; // Incomplete
    }

    // Check start byte
    if (buf[0] !== FRAME_START) {
        throw new Error(`Invalid frame start: 0x${buf[0].toString(16)}`);
    }

    // Get payload length (little-endian)
    const payloadLen = buf[1] | (buf[2] << 8);
    if (payloadLen > MAX_PAYLOAD) {
        throw new Error(`Payload too large: ${payloadLen}`);
    }

    // Check if we have full frame
    const frameLen = 7 + payloadLen;
    if (buf.length < frameLen) {
        return null; // Incomplete
    }

    // Verify checksum
    const expected = calculateChecksum(buf.slice(1, frameLen - 1));
    if (buf[frameLen - 1] !== expected) {
        throw new Error(`Checksum mismatch: expected 0x${expected.toString(16)}, got 0x${buf[frameLen - 1].toString(16)}`);
    }

    return {
        seq: buf[3],
        cmd: buf[4],
        status: buf[5],
        payload: buf.slice(6, 6 + payloadLen),
        frameLength: frameLen,
    };
}

/**
 * Helper to create a Uint8Array from various inputs
 * @param {string|number[]} data - Hex string or byte array
 * @returns {Uint8Array}
 */
export function toBytes(data) {
    if (typeof data === 'string') {
        // Hex string
        const hex = data.replace(/\s/g, '');
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
    }
    return new Uint8Array(data);
}

/**
 * Helper to convert bytes to hex string
 * @param {Uint8Array} data
 * @returns {string}
 */
export function toHex(data) {
    return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

/**
 * Encode a little-endian uint16
 * @param {number} value
 * @returns {Uint8Array}
 */
export function encodeUint16LE(value) {
    return new Uint8Array([value & 0xFF, (value >> 8) & 0xFF]);
}

/**
 * Encode a little-endian uint32
 * @param {number} value
 * @returns {Uint8Array}
 */
export function encodeUint32LE(value) {
    return new Uint8Array([
        value & 0xFF,
        (value >> 8) & 0xFF,
        (value >> 16) & 0xFF,
        (value >> 24) & 0xFF,
    ]);
}

/**
 * Decode a little-endian uint16
 * @param {Uint8Array} data
 * @param {number} offset
 * @returns {number}
 */
export function decodeUint16LE(data, offset = 0) {
    return data[offset] | (data[offset + 1] << 8);
}

/**
 * Decode a little-endian uint32
 * @param {Uint8Array} data
 * @param {number} offset
 * @returns {number}
 */
export function decodeUint32LE(data, offset = 0) {
    return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
}

/**
 * Encode a null-terminated string
 * @param {string} str
 * @returns {Uint8Array}
 */
export function encodeString(str) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const result = new Uint8Array(bytes.length + 1);
    result.set(bytes);
    result[bytes.length] = 0;
    return result;
}

/**
 * Decode a null-terminated string
 * @param {Uint8Array} data
 * @param {number} offset
 * @returns {{value: string, length: number}}
 */
export function decodeString(data, offset = 0) {
    let end = offset;
    while (end < data.length && data[end] !== 0) {
        end++;
    }
    const decoder = new TextDecoder();
    return {
        value: decoder.decode(data.slice(offset, end)),
        length: end - offset + 1,
    };
}
