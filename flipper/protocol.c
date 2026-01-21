#include "protocol.h"
#include <string.h>

uint8_t ecco_checksum(const uint8_t* data, size_t len) {
    uint8_t sum = 0;
    for (size_t i = 0; i < len; i++) {
        sum ^= data[i];
    }
    return sum;
}

int ecco_parse_frame(const uint8_t* buf, size_t len, EccoFrame* frame) {
    // Need at least 7 bytes: START(1) + LEN(2) + SEQ(1) + CMD(1) + STATUS(1) + CHECKSUM(1)
    if (len < 7) return 0;

    // Check start byte
    if (buf[0] != ECCO_FRAME_START) return -1;

    // Get payload length (little-endian)
    uint16_t payload_len = buf[1] | (buf[2] << 8);
    if (payload_len > ECCO_MAX_PAYLOAD) return -1;

    // Check if we have full frame
    size_t frame_len = 7 + payload_len;
    if (len < frame_len) return 0;

    // Verify checksum (XOR of bytes 1 to end-1)
    uint8_t expected = ecco_checksum(&buf[1], frame_len - 2);
    if (buf[frame_len - 1] != expected) return -1;

    // Parse frame
    frame->payload_len = payload_len;
    frame->seq = buf[3];
    frame->cmd = buf[4];
    frame->status = buf[5];
    if (payload_len > 0) {
        memcpy(frame->payload, &buf[6], payload_len);
    }

    return frame_len;
}

size_t ecco_build_frame(uint8_t* buf, const EccoFrame* frame) {
    size_t len = 7 + frame->payload_len;

    buf[0] = ECCO_FRAME_START;
    buf[1] = frame->payload_len & 0xFF;
    buf[2] = (frame->payload_len >> 8) & 0xFF;
    buf[3] = frame->seq;
    buf[4] = frame->cmd;
    buf[5] = frame->status;

    if (frame->payload_len > 0) {
        memcpy(&buf[6], frame->payload, frame->payload_len);
    }

    // Checksum
    buf[len - 1] = ecco_checksum(&buf[1], len - 2);

    return len;
}
