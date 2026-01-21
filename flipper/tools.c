#include "tools.h"
#include "ecco.h"
#include <furi_hal.h>
#include <furi_hal_version.h>
#include <furi_hal_subghz.h>
#include <furi_hal_infrared.h>
#include <storage/storage.h>
#include <string.h>
#include <lib/subghz/receiver.h>
#include <lib/subghz/transmitter.h>
#include <lib/subghz/subghz_file_encoder_worker.h>
#include <infrared_worker.h>

#define SUBGHZ_RAW_BUF_SIZE 2048
#define IR_RAW_BUF_SIZE 512

void ecco_dispatch(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    resp->seq = req->seq;
    resp->cmd = req->cmd;
    resp->status = STATUS_OK;
    resp->payload_len = 0;

    switch (req->cmd) {
        case CMD_PING:
            tool_ping(app, req, resp);
            break;
        case CMD_DEVICE_INFO:
            tool_device_info(app, req, resp);
            break;
        case CMD_SUBGHZ_CAPTURE:
            tool_subghz_capture(app, req, resp);
            break;
        case CMD_SUBGHZ_TRANSMIT:
            tool_subghz_transmit(app, req, resp);
            break;
        case CMD_NFC_READ:
            tool_nfc_read(app, req, resp);
            break;
        case CMD_NFC_EMULATE:
            tool_nfc_emulate(app, req, resp);
            break;
        case CMD_IR_RECEIVE:
            tool_ir_receive(app, req, resp);
            break;
        case CMD_IR_TRANSMIT:
            tool_ir_transmit(app, req, resp);
            break;
        case CMD_RFID_READ:
            tool_rfid_read(app, req, resp);
            break;
        case CMD_STORAGE_LIST:
            tool_storage_list(app, req, resp);
            break;
        case CMD_STORAGE_READ:
            tool_storage_read(app, req, resp);
            break;
        default:
            resp->status = STATUS_ERR_INVALID;
            break;
    }
}

void tool_ping(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);
    UNUSED(req);
    UNUSED(resp);
}

void tool_device_info(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);
    UNUSED(req);

    const Version* fw_version = furi_hal_version_get_firmware_version();
    resp->payload[0] = version_get_major(fw_version);
    resp->payload[1] = version_get_minor(fw_version);
    resp->payload[2] = version_get_patch(fw_version);

    const char* name = furi_hal_version_get_name_ptr();
    if (name) {
        strncpy((char*)&resp->payload[3], name, 31);
        resp->payload[34] = 0;
    } else {
        strncpy((char*)&resp->payload[3], "Flipper", 31);
    }

    resp->payload_len = 35;
}

// SubGHz capture state
typedef struct {
    EccoApp* app;
    int32_t* raw_data;
    size_t raw_len;
    size_t raw_capacity;
    bool done;
} SubGhzCaptureCtx;

static void subghz_capture_callback(bool level, uint32_t duration, void* ctx) {
    SubGhzCaptureCtx* capture = ctx;

    if (capture->raw_len < capture->raw_capacity) {
        capture->raw_data[capture->raw_len++] = level ? (int32_t)duration : -(int32_t)duration;
    }
}

void tool_subghz_capture(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    if (req->payload_len < 6) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    uint32_t frequency = req->payload[0] | (req->payload[1] << 8) |
                        (req->payload[2] << 16) | (req->payload[3] << 24);
    uint16_t timeout_sec = req->payload[4] | (req->payload[5] << 8);
    if (timeout_sec == 0) timeout_sec = 30;

    // Validate frequency
    if (!furi_hal_subghz_is_frequency_valid(frequency)) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    // Allocate capture buffer
    SubGhzCaptureCtx capture = {
        .app = app,
        .raw_data = malloc(SUBGHZ_RAW_BUF_SIZE * sizeof(int32_t)),
        .raw_len = 0,
        .raw_capacity = SUBGHZ_RAW_BUF_SIZE,
        .done = false,
    };

    if (!capture.raw_data) {
        resp->status = STATUS_ERR_UNKNOWN;
        return;
    }

    // Start capture
    furi_hal_subghz_reset();
    furi_hal_subghz_load_preset(FuriHalSubGhzPresetOok650Async);
    furi_hal_subghz_set_frequency_and_path(frequency);

    furi_hal_subghz_start_async_rx(subghz_capture_callback, &capture);

    // Wait for signal or timeout
    uint32_t start = furi_get_tick();
    uint32_t timeout_ms = timeout_sec * 1000;

    while ((furi_get_tick() - start) < timeout_ms) {
        if (capture.raw_len > 0) {
            // Got some data, wait a bit for signal to complete
            furi_delay_ms(500);
            if (capture.raw_len > 10) break; // Reasonable signal
        }
        furi_delay_ms(10);
    }

    furi_hal_subghz_stop_async_rx();
    furi_hal_subghz_sleep();

    if (capture.raw_len == 0) {
        free(capture.raw_data);
        resp->status = STATUS_ERR_TIMEOUT;
        return;
    }

    // Pack raw data into response
    // Format: data_len (2B) + raw timings (var)
    size_t data_bytes = capture.raw_len * sizeof(int32_t);
    if (data_bytes > ECCO_MAX_PAYLOAD - 2) {
        data_bytes = ECCO_MAX_PAYLOAD - 2;
    }

    resp->payload[0] = data_bytes & 0xFF;
    resp->payload[1] = (data_bytes >> 8) & 0xFF;
    memcpy(&resp->payload[2], capture.raw_data, data_bytes);
    resp->payload_len = 2 + data_bytes;

    free(capture.raw_data);
}

void tool_subghz_transmit(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);

    if (req->payload_len < 6) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    uint32_t frequency = req->payload[0] | (req->payload[1] << 8) |
                        (req->payload[2] << 16) | (req->payload[3] << 24);
    uint16_t data_len = req->payload[4] | (req->payload[5] << 8);

    if (req->payload_len < 6 + data_len) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    if (!furi_hal_subghz_is_frequency_valid(frequency)) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    // Parse raw data
    const int32_t* raw_data = (const int32_t*)&req->payload[6];
    size_t raw_count = data_len / sizeof(int32_t);

    // Transmit
    furi_hal_subghz_reset();
    furi_hal_subghz_load_preset(FuriHalSubGhzPresetOok650Async);
    furi_hal_subghz_set_frequency_and_path(frequency);

    if (!furi_hal_subghz_start_async_tx(NULL, NULL)) {
        furi_hal_subghz_sleep();
        resp->status = STATUS_ERR_BUSY;
        return;
    }

    // Send raw timings
    for (size_t i = 0; i < raw_count; i++) {
        int32_t duration = raw_data[i];
        bool level = duration > 0;
        uint32_t abs_duration = level ? duration : -duration;

        furi_hal_subghz_async_tx_feed(level, abs_duration);
    }

    furi_hal_subghz_stop_async_tx();
    furi_hal_subghz_sleep();
}

// NFC callbacks
typedef struct {
    EccoApp* app;
    NfcDeviceData* data;
    bool done;
} NfcReadCtx;

void tool_nfc_read(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    uint16_t timeout_sec = 30;
    if (req->payload_len >= 2) {
        timeout_sec = req->payload[0] | (req->payload[1] << 8);
    }

    Nfc* nfc = nfc_alloc();
    NfcDevice* nfc_device = nfc_device_alloc();

    nfc_config(nfc, NfcModePoller, NfcTechIso14443a);
    nfc_start(nfc, NULL, NULL);

    // Poll for card
    uint32_t start = furi_get_tick();
    uint32_t timeout_ms = timeout_sec * 1000;
    bool found = false;

    while ((furi_get_tick() - start) < timeout_ms) {
        if (nfc_poller_detect(nfc)) {
            found = true;
            break;
        }
        furi_delay_ms(100);
    }

    if (!found) {
        nfc_stop(nfc);
        nfc_free(nfc);
        nfc_device_free(nfc_device);
        resp->status = STATUS_ERR_TIMEOUT;
        return;
    }

    // Read card data
    NfcError error = nfc_poller_read(nfc, nfc_device);

    if (error != NfcErrorNone) {
        nfc_stop(nfc);
        nfc_free(nfc);
        nfc_device_free(nfc_device);
        resp->status = STATUS_ERR_NO_DATA;
        return;
    }

    // Get UID
    const uint8_t* uid = nfc_device_get_uid(nfc_device);
    size_t uid_len = nfc_device_get_uid_len(nfc_device);

    // Determine type
    NfcProtocol protocol = nfc_device_get_protocol(nfc_device);
    uint8_t type = 0;
    switch (protocol) {
        case NfcProtocolMfClassic: type = 1; break;
        case NfcProtocolMfUltralight: type = 2; break;
        default: type = 4; break;
    }

    // Build response
    resp->payload[0] = type;
    resp->payload[1] = uid_len;
    memcpy(&resp->payload[2], uid, uid_len);
    resp->payload_len = 2 + uid_len;

    nfc_stop(nfc);
    nfc_free(nfc);
    nfc_device_free(nfc_device);
}

void tool_nfc_emulate(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);

    if (req->payload_len < 3) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    uint8_t type = req->payload[0];
    uint8_t uid_len = req->payload[1];

    if (req->payload_len < 2 + uid_len) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    UNUSED(type);
    UNUSED(uid_len);

    // NFC emulation requires keeping the app running
    // For now just acknowledge - full implementation would need async handling
    resp->status = STATUS_ERR_INVALID; // Not fully implemented yet
}

// IR capture context
typedef struct {
    uint32_t* timings;
    size_t count;
    size_t capacity;
} IrCaptureCtx;

static void ir_capture_callback(void* ctx, InfraredWorkerSignal* signal) {
    IrCaptureCtx* capture = ctx;

    if (infrared_worker_signal_is_decoded(signal)) {
        const InfraredMessage* msg = infrared_worker_signal_get_message(signal);
        UNUSED(msg);
    } else {
        size_t timings_cnt;
        const uint32_t* timings = infrared_worker_signal_get_raw_signal(signal, &timings_cnt);

        for (size_t i = 0; i < timings_cnt && capture->count < capture->capacity; i++) {
            capture->timings[capture->count++] = timings[i];
        }
    }
}

void tool_ir_receive(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);

    uint16_t timeout_sec = 30;
    if (req->payload_len >= 2) {
        timeout_sec = req->payload[0] | (req->payload[1] << 8);
    }

    IrCaptureCtx capture = {
        .timings = malloc(IR_RAW_BUF_SIZE * sizeof(uint32_t)),
        .count = 0,
        .capacity = IR_RAW_BUF_SIZE,
    };

    if (!capture.timings) {
        resp->status = STATUS_ERR_UNKNOWN;
        return;
    }

    InfraredWorker* worker = infrared_worker_alloc();
    infrared_worker_rx_set_received_signal_callback(worker, ir_capture_callback, &capture);
    infrared_worker_rx_start(worker);

    uint32_t start = furi_get_tick();
    uint32_t timeout_ms = timeout_sec * 1000;

    while ((furi_get_tick() - start) < timeout_ms && capture.count == 0) {
        furi_delay_ms(100);
    }

    // Give time for full signal
    if (capture.count > 0) {
        furi_delay_ms(300);
    }

    infrared_worker_rx_stop(worker);
    infrared_worker_free(worker);

    if (capture.count == 0) {
        free(capture.timings);
        resp->status = STATUS_ERR_TIMEOUT;
        return;
    }

    // Build response: protocol (1B) + data_len (2B) + timings
    size_t data_bytes = capture.count * sizeof(uint32_t);
    if (data_bytes > ECCO_MAX_PAYLOAD - 3) {
        data_bytes = ECCO_MAX_PAYLOAD - 3;
    }

    resp->payload[0] = 0; // Raw protocol
    resp->payload[1] = data_bytes & 0xFF;
    resp->payload[2] = (data_bytes >> 8) & 0xFF;
    memcpy(&resp->payload[3], capture.timings, data_bytes);
    resp->payload_len = 3 + data_bytes;

    free(capture.timings);
}

void tool_ir_transmit(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);

    if (req->payload_len < 3) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    uint8_t protocol = req->payload[0];
    uint16_t data_len = req->payload[1] | (req->payload[2] << 8);
    UNUSED(protocol);

    if (req->payload_len < 3 + data_len) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    const uint32_t* timings = (const uint32_t*)&req->payload[3];
    size_t timings_count = data_len / sizeof(uint32_t);

    InfraredWorker* worker = infrared_worker_alloc();

    // Create signal and transmit
    InfraredWorkerSignal* signal = infrared_worker_signal_alloc();
    infrared_worker_signal_set_raw_signal(
        signal,
        timings,
        timings_count,
        38000, // Standard IR frequency
        0.33f  // Duty cycle
    );

    infrared_worker_tx_start(worker);
    infrared_worker_signal_transmit(worker, signal);
    infrared_worker_tx_stop(worker);

    infrared_worker_signal_free(signal);
    infrared_worker_free(worker);
}

// RFID read callback
typedef struct {
    uint8_t type;
    uint8_t data[8];
    size_t data_len;
    bool done;
} RfidReadCtx;

static void rfid_read_callback(LFRFIDWorkerReadResult result, ProtocolId protocol, void* ctx) {
    RfidReadCtx* rfid = ctx;

    if (result == LFRFIDWorkerReadDone) {
        rfid->done = true;

        // Map protocol to our type codes
        switch (protocol) {
            case LFRFIDProtocolEM4100:
                rfid->type = 1;
                break;
            case LFRFIDProtocolHIDProx:
            case LFRFIDProtocolHIDExProx:
                rfid->type = 2;
                break;
            case LFRFIDProtocolIndala26:
                rfid->type = 3;
                break;
            default:
                rfid->type = 0;
                break;
        }
    }
}

void tool_rfid_read(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);

    uint16_t timeout_sec = 30;
    if (req->payload_len >= 2) {
        timeout_sec = req->payload[0] | (req->payload[1] << 8);
    }

    RfidReadCtx rfid = {
        .type = 0,
        .data_len = 0,
        .done = false,
    };

    ProtocolDict* dict = protocol_dict_alloc(lfrfid_protocols, LFRFIDProtocolMax);
    LFRFIDWorker* worker = lfrfid_worker_alloc(dict);

    lfrfid_worker_read_start(worker, LFRFIDWorkerReadTypeASKOnly, rfid_read_callback, &rfid);

    uint32_t start = furi_get_tick();
    uint32_t timeout_ms = timeout_sec * 1000;

    while ((furi_get_tick() - start) < timeout_ms && !rfid.done) {
        furi_delay_ms(100);
    }

    lfrfid_worker_stop(worker);

    if (!rfid.done) {
        lfrfid_worker_free(worker);
        protocol_dict_free(dict);
        resp->status = STATUS_ERR_TIMEOUT;
        return;
    }

    // Get card data
    size_t data_size = protocol_dict_get_data_size(dict, worker->protocol);
    if (data_size > sizeof(rfid.data)) data_size = sizeof(rfid.data);

    protocol_dict_get_data(dict, worker->protocol, rfid.data, data_size);

    // Build response
    resp->payload[0] = rfid.type;
    memcpy(&resp->payload[1], rfid.data, data_size);
    resp->payload_len = 1 + data_size;

    lfrfid_worker_free(worker);
    protocol_dict_free(dict);
}

void tool_storage_list(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);

    if (req->payload_len < 1) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    Storage* storage = furi_record_open(RECORD_STORAGE);
    File* dir = storage_file_alloc(storage);

    const char* path = (const char*)req->payload;

    if (!storage_dir_open(dir, path)) {
        resp->status = STATUS_ERR_NOT_FOUND;
        storage_file_free(dir);
        furi_record_close(RECORD_STORAGE);
        return;
    }

    FileInfo info;
    char name[256];
    uint8_t count = 0;
    size_t offset = 1;

    while (storage_dir_read(dir, &info, name, sizeof(name)) && offset < ECCO_MAX_PAYLOAD - 256) {
        size_t name_len = strlen(name);
        memcpy(&resp->payload[offset], name, name_len + 1);
        offset += name_len + 1;
        count++;
        if (count >= 255) break;
    }

    resp->payload[0] = count;
    resp->payload_len = offset;

    storage_dir_close(dir);
    storage_file_free(dir);
    furi_record_close(RECORD_STORAGE);
}

void tool_storage_read(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);

    if (req->payload_len < 1) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    Storage* storage = furi_record_open(RECORD_STORAGE);
    File* file = storage_file_alloc(storage);

    const char* path = (const char*)req->payload;

    if (!storage_file_open(file, path, FSAM_READ, FSOM_OPEN_EXISTING)) {
        resp->status = STATUS_ERR_NOT_FOUND;
        storage_file_free(file);
        furi_record_close(RECORD_STORAGE);
        return;
    }

    uint64_t size = storage_file_size(file);
    if (size > ECCO_MAX_PAYLOAD - 4) {
        size = ECCO_MAX_PAYLOAD - 4;
    }

    resp->payload[0] = size & 0xFF;
    resp->payload[1] = (size >> 8) & 0xFF;
    resp->payload[2] = (size >> 16) & 0xFF;
    resp->payload[3] = (size >> 24) & 0xFF;

    uint16_t read = storage_file_read(file, &resp->payload[4], size);
    resp->payload_len = 4 + read;

    storage_file_close(file);
    storage_file_free(file);
    furi_record_close(RECORD_STORAGE);
}
