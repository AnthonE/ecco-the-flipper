#pragma once

#include "protocol.h"
#include <furi.h>

typedef struct EccoApp EccoApp;

// Tool handlers - each takes request frame, fills response frame
void tool_ping(EccoApp* app, const EccoFrame* req, EccoFrame* resp);
void tool_device_info(EccoApp* app, const EccoFrame* req, EccoFrame* resp);
void tool_subghz_capture(EccoApp* app, const EccoFrame* req, EccoFrame* resp);
void tool_subghz_transmit(EccoApp* app, const EccoFrame* req, EccoFrame* resp);
void tool_nfc_read(EccoApp* app, const EccoFrame* req, EccoFrame* resp);
void tool_nfc_emulate(EccoApp* app, const EccoFrame* req, EccoFrame* resp);
void tool_ir_receive(EccoApp* app, const EccoFrame* req, EccoFrame* resp);
void tool_ir_transmit(EccoApp* app, const EccoFrame* req, EccoFrame* resp);
void tool_rfid_read(EccoApp* app, const EccoFrame* req, EccoFrame* resp);
void tool_storage_list(EccoApp* app, const EccoFrame* req, EccoFrame* resp);
void tool_storage_read(EccoApp* app, const EccoFrame* req, EccoFrame* resp);

// Dispatch command to appropriate handler
void ecco_dispatch(EccoApp* app, const EccoFrame* req, EccoFrame* resp);
