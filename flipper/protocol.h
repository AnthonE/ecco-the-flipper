#pragma once

#include <stdint.h>
#include <stdbool.h>

#define ECCO_FRAME_START 0xEC
#define ECCO_MAX_PAYLOAD 1024

// Commands
#define CMD_PING           0x01
#define CMD_DEVICE_INFO    0x02
#define CMD_SUBGHZ_CAPTURE 0x10
#define CMD_SUBGHZ_TRANSMIT 0x11
#define CMD_NFC_READ       0x20
#define CMD_NFC_EMULATE    0x21
#define CMD_IR_RECEIVE     0x30
#define CMD_IR_TRANSMIT    0x31
#define CMD_RFID_READ      0x40
#define CMD_STORAGE_LIST   0x50
#define CMD_STORAGE_READ   0x51
#define CMD_DATA_CONTINUE  0x60

// Status codes
#define STATUS_OK          0x00
#define STATUS_ERR_UNKNOWN 0x01
#define STATUS_ERR_INVALID 0x02
#define STATUS_ERR_BUSY    0x03
#define STATUS_ERR_TIMEOUT 0x04
#define STATUS_ERR_NOT_FOUND 0x05
#define STATUS_ERR_NO_DATA 0x06

typedef struct {
    uint8_t seq;
    uint8_t cmd;
    uint8_t status;
    uint16_t payload_len;
    uint8_t payload[ECCO_MAX_PAYLOAD];
} EccoFrame;

// Parse incoming frame from buffer
// Returns bytes consumed, 0 if incomplete, -1 if invalid
int ecco_parse_frame(const uint8_t* buf, size_t len, EccoFrame* frame);

// Build response frame into buffer
// Returns frame length
size_t ecco_build_frame(uint8_t* buf, const EccoFrame* frame);

// Calculate checksum
uint8_t ecco_checksum(const uint8_t* data, size_t len);
