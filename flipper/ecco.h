#pragma once

#include <furi.h>
#include <furi_hal.h>
#include <gui/gui.h>
#include <lib/subghz/subghz_tx_rx_worker.h>
#include <lib/nfc/nfc.h>
#include <lib/infrared/infrared.h>
#include <lib/lfrfid/lfrfid_worker.h>

typedef struct {
    Gui* gui;
    ViewPort* view_port;
    FuriMessageQueue* event_queue;
    FuriStreamBuffer* uart_rx_stream;
    FuriThread* uart_thread;
    bool running;

    // Hardware modules
    SubGhzTxRxWorker* subghz_worker;
    Nfc* nfc;
    LFRFIDWorker* rfid_worker;

    // Capture buffers
    uint8_t* capture_buf;
    size_t capture_len;
    bool capture_done;
} EccoApp;
