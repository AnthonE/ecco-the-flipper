// Ecco Webapp - Claude agent with Flipper Zero tools

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// Protocol constants
const FRAME_START = 0xEC;
const CMD = {
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
};

// Tool definitions for Claude
const TOOLS = [
    {
        name: 'device_info',
        description: 'Get Flipper Zero device information including firmware version and name',
        input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
        name: 'subghz_capture',
        description: 'Capture a Sub-GHz radio signal. Use this when asked to capture, record, or listen for a wireless signal like a garage door, car key, or remote.',
        input_schema: {
            type: 'object',
            properties: {
                frequency: { type: 'number', description: 'Frequency in Hz (e.g., 433920000 for 433.92 MHz). Common frequencies: 315000000, 433920000, 868000000, 915000000' },
                timeout: { type: 'number', description: 'Timeout in seconds (default 30)' }
            },
            required: ['frequency']
        }
    },
    {
        name: 'subghz_transmit',
        description: 'Transmit a previously captured Sub-GHz signal',
        input_schema: {
            type: 'object',
            properties: {
                frequency: { type: 'number', description: 'Frequency in Hz' },
                data: { type: 'string', description: 'Base64-encoded signal data from a previous capture' }
            },
            required: ['frequency', 'data']
        }
    },
    {
        name: 'nfc_read',
        description: 'Read an NFC tag. Use when asked to read, scan, or identify an NFC card or tag.',
        input_schema: {
            type: 'object',
            properties: {
                timeout: { type: 'number', description: 'Timeout in seconds (default 30)' }
            },
            required: []
        }
    },
    {
        name: 'nfc_emulate',
        description: 'Emulate an NFC tag with the given data',
        input_schema: {
            type: 'object',
            properties: {
                type: { type: 'number', description: 'NFC type: 1=MIFARE Classic, 2=MIFARE Ultralight, 3=NTAG' },
                uid: { type: 'string', description: 'UID as hex string' },
                data: { type: 'string', description: 'Tag data as base64' }
            },
            required: ['type', 'uid']
        }
    },
    {
        name: 'ir_receive',
        description: 'Capture an infrared signal from a remote control',
        input_schema: {
            type: 'object',
            properties: {
                timeout: { type: 'number', description: 'Timeout in seconds (default 30)' }
            },
            required: []
        }
    },
    {
        name: 'ir_transmit',
        description: 'Transmit an infrared signal',
        input_schema: {
            type: 'object',
            properties: {
                data: { type: 'string', description: 'IR signal data from a previous capture' }
            },
            required: ['data']
        }
    },
    {
        name: 'rfid_read',
        description: 'Read a 125kHz RFID tag (like access cards)',
        input_schema: {
            type: 'object',
            properties: {
                timeout: { type: 'number', description: 'Timeout in seconds (default 30)' }
            },
            required: []
        }
    },
    {
        name: 'storage_list',
        description: 'List files in a directory on the Flipper SD card',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Directory path (e.g., /ext/subghz)' }
            },
            required: ['path']
        }
    },
    {
        name: 'storage_read',
        description: 'Read a file from the Flipper SD card',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path (e.g., /ext/subghz/garage.sub)' }
            },
            required: ['path']
        }
    }
];

class Ecco {
    constructor() {
        this.ws = null;
        this.apiKey = null;
        this.messages = [];
        this.seq = 0;
        this.pendingRequests = new Map();

        this.setupUI();
    }

    setupUI() {
        this.statusEl = document.getElementById('status');
        this.setupEl = document.getElementById('setup');
        this.chatEl = document.getElementById('chat');
        this.messagesEl = document.getElementById('messages');
        this.inputEl = document.getElementById('user-input');
        this.apiKeyEl = document.getElementById('api-key');

        document.getElementById('connect-btn').onclick = () => this.connect();
        document.getElementById('input-form').onsubmit = (e) => {
            e.preventDefault();
            this.sendMessage();
        };

        // Load saved API key
        const savedKey = localStorage.getItem('ecco-api-key');
        if (savedKey) this.apiKeyEl.value = savedKey;
    }

    connect() {
        this.apiKey = this.apiKeyEl.value.trim();
        if (!this.apiKey) {
            alert('Please enter your Anthropic API key');
            return;
        }

        localStorage.setItem('ecco-api-key', this.apiKey);
        this.setStatus('connecting');

        const wsUrl = `ws://${window.location.host}/ws`;
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
            this.setStatus('connected');
            this.setupEl.classList.add('hidden');
            this.chatEl.classList.remove('hidden');
            this.ping();
        };

        this.ws.onclose = () => {
            this.setStatus('disconnected');
            this.setupEl.classList.remove('hidden');
            this.chatEl.classList.add('hidden');
        };

        this.ws.onerror = (e) => {
            console.error('WebSocket error:', e);
            this.setStatus('disconnected');
        };

        this.ws.onmessage = (e) => this.handleFrame(e.data);
    }

    setStatus(status) {
        this.statusEl.className = status;
        this.statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }

    // Build binary frame
    buildFrame(cmd, payload = new Uint8Array()) {
        const seq = this.seq++ & 0xFF;
        const len = payload.length;
        const frame = new Uint8Array(7 + len);

        frame[0] = FRAME_START;
        frame[1] = len & 0xFF;
        frame[2] = (len >> 8) & 0xFF;
        frame[3] = seq;
        frame[4] = cmd;
        frame[5] = 0x00; // status (request)
        frame.set(payload, 6);

        // Checksum: XOR of bytes 1 to end-1
        let checksum = 0;
        for (let i = 1; i < frame.length - 1; i++) {
            checksum ^= frame[i];
        }
        frame[frame.length - 1] = checksum;

        return { frame, seq };
    }

    // Parse response frame
    parseFrame(data) {
        const view = new DataView(data);
        if (view.getUint8(0) !== FRAME_START) {
            throw new Error('Invalid frame start');
        }

        const len = view.getUint16(1, true);
        const seq = view.getUint8(3);
        const cmd = view.getUint8(4);
        const status = view.getUint8(5);
        const payload = new Uint8Array(data, 6, len);

        return { seq, cmd, status, payload };
    }

    // Send frame and wait for response
    sendFrame(cmd, payload = new Uint8Array()) {
        return new Promise((resolve, reject) => {
            const { frame, seq } = this.buildFrame(cmd, payload);

            const timeout = setTimeout(() => {
                this.pendingRequests.delete(seq);
                reject(new Error('Timeout'));
            }, 30000);

            this.pendingRequests.set(seq, { resolve, reject, timeout });
            this.ws.send(frame);
        });
    }

    handleFrame(data) {
        try {
            const { seq, cmd, status, payload } = this.parseFrame(data);
            const pending = this.pendingRequests.get(seq);

            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(seq);

                if (status === 0x00) {
                    pending.resolve({ cmd, payload });
                } else {
                    pending.reject(new Error(`Device error: 0x${status.toString(16)}`));
                }
            }
        } catch (e) {
            console.error('Frame parse error:', e);
        }
    }

    async ping() {
        try {
            await this.sendFrame(CMD.PING);
            console.log('Flipper connected');
        } catch (e) {
            console.error('Ping failed:', e);
        }
    }

    // Execute a tool on the Flipper
    async executeTool(name, input) {
        switch (name) {
            case 'device_info':
                return this.cmdDeviceInfo();
            case 'subghz_capture':
                return this.cmdSubghzCapture(input.frequency, input.timeout || 30);
            case 'subghz_transmit':
                return this.cmdSubghzTransmit(input.frequency, input.data);
            case 'nfc_read':
                return this.cmdNfcRead(input.timeout || 30);
            case 'nfc_emulate':
                return this.cmdNfcEmulate(input.type, input.uid, input.data);
            case 'ir_receive':
                return this.cmdIrReceive(input.timeout || 30);
            case 'ir_transmit':
                return this.cmdIrTransmit(input.data);
            case 'rfid_read':
                return this.cmdRfidRead(input.timeout || 30);
            case 'storage_list':
                return this.cmdStorageList(input.path);
            case 'storage_read':
                return this.cmdStorageRead(input.path);
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    async cmdDeviceInfo() {
        const { payload } = await this.sendFrame(CMD.DEVICE_INFO);
        const view = new DataView(payload.buffer);
        const major = view.getUint8(0);
        const minor = view.getUint8(1);
        const patch = view.getUint8(2);
        const name = new TextDecoder().decode(payload.slice(3)).replace(/\0/g, '');
        return { firmware: `${major}.${minor}.${patch}`, name };
    }

    async cmdSubghzCapture(frequency, timeout) {
        const payload = new Uint8Array(6);
        const view = new DataView(payload.buffer);
        view.setUint32(0, frequency, true);
        view.setUint16(4, timeout, true);

        const { payload: resp } = await this.sendFrame(CMD.SUBGHZ_CAPTURE, payload);
        const dataLen = new DataView(resp.buffer).getUint16(0, true);
        const data = resp.slice(2, 2 + dataLen);
        return { captured: true, data: btoa(String.fromCharCode(...data)) };
    }

    async cmdSubghzTransmit(frequency, data) {
        const rawData = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        const payload = new Uint8Array(6 + rawData.length);
        const view = new DataView(payload.buffer);
        view.setUint32(0, frequency, true);
        view.setUint16(4, rawData.length, true);
        payload.set(rawData, 6);

        await this.sendFrame(CMD.SUBGHZ_TRANSMIT, payload);
        return { transmitted: true };
    }

    async cmdNfcRead(timeout) {
        const payload = new Uint8Array(2);
        new DataView(payload.buffer).setUint16(0, timeout, true);

        const { payload: resp } = await this.sendFrame(CMD.NFC_READ, payload);
        const type = resp[0];
        const uidLen = resp[1];
        const uid = Array.from(resp.slice(2, 2 + uidLen)).map(b => b.toString(16).padStart(2, '0')).join(':');
        const data = btoa(String.fromCharCode(...resp.slice(2 + uidLen)));

        const typeNames = { 1: 'MIFARE Classic', 2: 'MIFARE Ultralight', 3: 'NTAG', 4: 'ISO14443-4' };
        return { type: typeNames[type] || 'Unknown', uid, data };
    }

    async cmdNfcEmulate(type, uid, data) {
        const uidBytes = uid.split(':').map(h => parseInt(h, 16));
        const dataBytes = data ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : new Uint8Array();
        const payload = new Uint8Array(2 + uidBytes.length + dataBytes.length);
        payload[0] = type;
        payload[1] = uidBytes.length;
        payload.set(uidBytes, 2);
        payload.set(dataBytes, 2 + uidBytes.length);

        await this.sendFrame(CMD.NFC_EMULATE, payload);
        return { emulating: true };
    }

    async cmdIrReceive(timeout) {
        const payload = new Uint8Array(2);
        new DataView(payload.buffer).setUint16(0, timeout, true);

        const { payload: resp } = await this.sendFrame(CMD.IR_RECEIVE, payload);
        const protocol = resp[0];
        const dataLen = new DataView(resp.buffer).getUint16(1, true);
        const data = btoa(String.fromCharCode(...resp.slice(3, 3 + dataLen)));
        return { protocol, data };
    }

    async cmdIrTransmit(data) {
        const rawData = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        const payload = new Uint8Array(3 + rawData.length);
        payload[0] = 0; // protocol (raw)
        new DataView(payload.buffer).setUint16(1, rawData.length, true);
        payload.set(rawData, 3);

        await this.sendFrame(CMD.IR_TRANSMIT, payload);
        return { transmitted: true };
    }

    async cmdRfidRead(timeout) {
        const payload = new Uint8Array(2);
        new DataView(payload.buffer).setUint16(0, timeout, true);

        const { payload: resp } = await this.sendFrame(CMD.RFID_READ, payload);
        const type = resp[0];
        const data = Array.from(resp.slice(1)).map(b => b.toString(16).padStart(2, '0')).join(':');

        const typeNames = { 1: 'EM4100', 2: 'HID Prox', 3: 'Indala' };
        return { type: typeNames[type] || 'Unknown', data };
    }

    async cmdStorageList(path) {
        const pathBytes = new TextEncoder().encode(path + '\0');
        const { payload } = await this.sendFrame(CMD.STORAGE_LIST, pathBytes);

        const count = payload[0];
        const files = [];
        let offset = 1;
        for (let i = 0; i < count; i++) {
            let end = offset;
            while (payload[end] !== 0) end++;
            files.push(new TextDecoder().decode(payload.slice(offset, end)));
            offset = end + 1;
        }
        return { files };
    }

    async cmdStorageRead(path) {
        const pathBytes = new TextEncoder().encode(path + '\0');
        const { payload } = await this.sendFrame(CMD.STORAGE_READ, pathBytes);

        const size = new DataView(payload.buffer).getUint32(0, true);
        const content = new TextDecoder().decode(payload.slice(4, 4 + size));
        return { size, content };
    }

    // Chat with Claude
    async chat(userMessage) {
        this.messages.push({ role: 'user', content: userMessage });
        this.addMessageUI('user', userMessage);

        try {
            let response = await this.callClaude();

            // Handle tool use loop
            while (response.stop_reason === 'tool_use') {
                const toolUses = response.content.filter(c => c.type === 'tool_use');
                const toolResults = [];

                for (const toolUse of toolUses) {
                    this.addMessageUI('tool', `Calling ${toolUse.name}...`);

                    try {
                        const result = await this.executeTool(toolUse.name, toolUse.input);
                        this.addMessageUI('tool', `${toolUse.name}: ${JSON.stringify(result)}`);
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify(result)
                        });
                    } catch (e) {
                        this.addMessageUI('error', `${toolUse.name} failed: ${e.message}`);
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: `Error: ${e.message}`,
                            is_error: true
                        });
                    }
                }

                this.messages.push({ role: 'assistant', content: response.content });
                this.messages.push({ role: 'user', content: toolResults });
                response = await this.callClaude();
            }

            // Extract text response
            const text = response.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');

            this.messages.push({ role: 'assistant', content: response.content });
            this.addMessageUI('assistant', text);

        } catch (e) {
            this.addMessageUI('error', `Error: ${e.message}`);
        }
    }

    async callClaude() {
        const response = await fetch(CLAUDE_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: CLAUDE_MODEL,
                max_tokens: 1024,
                system: `You are Ecco, an AI assistant running on a Flipper Zero device. You can control the Flipper's hardware to capture and transmit radio signals (Sub-GHz), read and emulate NFC tags, capture and transmit IR signals, and read RFID tags. Be concise and helpful. When asked to do something, use the appropriate tool. Explain what you find in simple terms.`,
                tools: TOOLS,
                messages: this.messages
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'API request failed');
        }

        return response.json();
    }

    addMessageUI(type, text) {
        const div = document.createElement('div');
        div.className = `message ${type}`;
        div.textContent = text;
        this.messagesEl.appendChild(div);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    sendMessage() {
        const text = this.inputEl.value.trim();
        if (!text) return;

        this.inputEl.value = '';
        this.chat(text);
    }
}

// Start
const ecco = new Ecco();
