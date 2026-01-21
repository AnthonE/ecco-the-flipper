#pragma once

#include <furi.h>
#include <furi_hal.h>
#include <gui/gui.h>

typedef struct {
    Gui* gui;
    ViewPort* view_port;
    FuriMessageQueue* event_queue;
    FuriStreamBuffer* uart_rx_stream;
    FuriThread* uart_thread;
    bool running;
} EccoApp;
