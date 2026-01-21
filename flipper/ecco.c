#include "ecco.h"
#include "protocol.h"
#include "tools.h"
#include <furi_hal_uart.h>
#include <gui/elements.h>

#define UART_CH FuriHalUartIdUSART1
#define UART_BAUD 115200
#define RX_BUF_SIZE 2048

static void ecco_draw_callback(Canvas* canvas, void* ctx) {
    UNUSED(ctx);
    canvas_clear(canvas);
    canvas_set_font(canvas, FontPrimary);
    canvas_draw_str_aligned(canvas, 64, 20, AlignCenter, AlignCenter, "Ecco");
    canvas_set_font(canvas, FontSecondary);
    canvas_draw_str_aligned(canvas, 64, 36, AlignCenter, AlignCenter, "Waiting for commands...");
    canvas_draw_str_aligned(canvas, 64, 50, AlignCenter, AlignCenter, "Press Back to exit");
}

static void ecco_input_callback(InputEvent* event, void* ctx) {
    FuriMessageQueue* queue = ctx;
    furi_message_queue_put(queue, event, FuriWaitForever);
}

static void uart_rx_callback(UartIrqEvent event, uint8_t data, void* ctx) {
    FuriStreamBuffer* stream = ctx;
    if (event == UartIrqEventRXNE) {
        furi_stream_buffer_send(stream, &data, 1, 0);
    }
}

static int32_t uart_worker(void* ctx) {
    EccoApp* app = ctx;
    uint8_t rx_buf[RX_BUF_SIZE];
    size_t rx_len = 0;
    EccoFrame req, resp;
    uint8_t tx_buf[ECCO_MAX_PAYLOAD + 16];

    while (app->running) {
        // Read available data
        size_t received = furi_stream_buffer_receive(
            app->uart_rx_stream,
            &rx_buf[rx_len],
            RX_BUF_SIZE - rx_len,
            100
        );

        if (received > 0) {
            rx_len += received;

            // Try to parse frame
            int consumed = ecco_parse_frame(rx_buf, rx_len, &req);

            if (consumed > 0) {
                // Valid frame, process it
                ecco_dispatch(app, &req, &resp);

                // Send response
                size_t tx_len = ecco_build_frame(tx_buf, &resp);
                furi_hal_uart_tx(UART_CH, tx_buf, tx_len);

                // Remove processed bytes
                if ((size_t)consumed < rx_len) {
                    memmove(rx_buf, &rx_buf[consumed], rx_len - consumed);
                    rx_len -= consumed;
                } else {
                    rx_len = 0;
                }
            } else if (consumed < 0) {
                // Invalid frame, discard first byte and try again
                if (rx_len > 1) {
                    memmove(rx_buf, &rx_buf[1], rx_len - 1);
                    rx_len--;
                } else {
                    rx_len = 0;
                }
            }
            // consumed == 0 means incomplete, wait for more data
        }
    }

    return 0;
}

int32_t ecco_app(void* p) {
    UNUSED(p);

    EccoApp* app = malloc(sizeof(EccoApp));
    app->running = true;

    // Set up GUI
    app->gui = furi_record_open(RECORD_GUI);
    app->view_port = view_port_alloc();
    app->event_queue = furi_message_queue_alloc(8, sizeof(InputEvent));

    view_port_draw_callback_set(app->view_port, ecco_draw_callback, app);
    view_port_input_callback_set(app->view_port, ecco_input_callback, app->event_queue);
    gui_add_view_port(app->gui, app->view_port, GuiLayerFullscreen);

    // Set up UART
    app->uart_rx_stream = furi_stream_buffer_alloc(RX_BUF_SIZE, 1);
    furi_hal_uart_init(UART_CH, UART_BAUD);
    furi_hal_uart_set_irq_cb(UART_CH, uart_rx_callback, app->uart_rx_stream);

    // Start UART worker thread
    app->uart_thread = furi_thread_alloc();
    furi_thread_set_name(app->uart_thread, "EccoUART");
    furi_thread_set_stack_size(app->uart_thread, 2048);
    furi_thread_set_context(app->uart_thread, app);
    furi_thread_set_callback(app->uart_thread, uart_worker);
    furi_thread_start(app->uart_thread);

    // Main loop
    InputEvent event;
    while (app->running) {
        if (furi_message_queue_get(app->event_queue, &event, 100) == FuriStatusOk) {
            if (event.type == InputTypePress && event.key == InputKeyBack) {
                app->running = false;
            }
        }
    }

    // Cleanup
    furi_thread_join(app->uart_thread);
    furi_thread_free(app->uart_thread);

    furi_hal_uart_set_irq_cb(UART_CH, NULL, NULL);
    furi_hal_uart_deinit(UART_CH);
    furi_stream_buffer_free(app->uart_rx_stream);

    gui_remove_view_port(app->gui, app->view_port);
    view_port_free(app->view_port);
    furi_message_queue_free(app->event_queue);
    furi_record_close(RECORD_GUI);

    free(app);
    return 0;
}
