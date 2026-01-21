#include "tools.h"
#include "ecco.h"
#include <furi_hal.h>
#include <furi_hal_version.h>
#include <storage/storage.h>
#include <string.h>

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
    // Empty response, status OK
}

void tool_device_info(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);
    UNUSED(req);

    // Firmware version
    resp->payload[0] = 1; // major
    resp->payload[1] = 0; // minor
    resp->payload[2] = 0; // patch

    // Device name (32 bytes, null-padded)
    const char* name = furi_hal_version_get_name_ptr();
    if (name) {
        strncpy((char*)&resp->payload[3], name, 31);
        resp->payload[34] = 0;
    } else {
        strncpy((char*)&resp->payload[3], "Flipper", 31);
    }

    resp->payload_len = 35;
}

void tool_subghz_capture(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);

    if (req->payload_len < 6) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    // Parse frequency and timeout
    uint32_t frequency = req->payload[0] | (req->payload[1] << 8) |
                        (req->payload[2] << 16) | (req->payload[3] << 24);
    uint16_t timeout = req->payload[4] | (req->payload[5] << 8);

    UNUSED(frequency);
    UNUSED(timeout);

    // TODO: Implement actual SubGHz capture
    // For now, return error
    resp->status = STATUS_ERR_NO_DATA;
}

void tool_subghz_transmit(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);

    if (req->payload_len < 6) {
        resp->status = STATUS_ERR_INVALID;
        return;
    }

    // TODO: Implement actual SubGHz transmit
    resp->status = STATUS_ERR_INVALID;
}

void tool_nfc_read(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);
    UNUSED(req);

    // TODO: Implement NFC read
    resp->status = STATUS_ERR_NO_DATA;
}

void tool_nfc_emulate(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);
    UNUSED(req);

    // TODO: Implement NFC emulation
    resp->status = STATUS_ERR_INVALID;
}

void tool_ir_receive(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);
    UNUSED(req);

    // TODO: Implement IR receive
    resp->status = STATUS_ERR_NO_DATA;
}

void tool_ir_transmit(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);
    UNUSED(req);

    // TODO: Implement IR transmit
    resp->status = STATUS_ERR_INVALID;
}

void tool_rfid_read(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
    UNUSED(app);
    UNUSED(req);

    // TODO: Implement RFID read
    resp->status = STATUS_ERR_NO_DATA;
}

void tool_storage_list(EccoApp* app, const EccoFrame* req, EccoFrame* resp) {
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
    size_t offset = 1; // First byte is count

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

    // Write size (4 bytes, little-endian)
    resp->payload[0] = size & 0xFF;
    resp->payload[1] = (size >> 8) & 0xFF;
    resp->payload[2] = (size >> 16) & 0xFF;
    resp->payload[3] = (size >> 24) & 0xFF;

    // Read file content
    uint16_t read = storage_file_read(file, &resp->payload[4], size);
    resp->payload_len = 4 + read;

    storage_file_close(file);
    storage_file_free(file);
    furi_record_close(RECORD_STORAGE);
}
