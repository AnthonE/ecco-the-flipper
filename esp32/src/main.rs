use anyhow::Result;
use esp_idf_hal::prelude::*;
use esp_idf_hal::uart::{self, UartDriver};
use esp_idf_hal::gpio;
use esp_idf_svc::eventloop::EspSystemEventLoop;
use esp_idf_svc::nvs::EspDefaultNvsPartition;
use esp_idf_svc::wifi::{AccessPointConfiguration, AuthMethod, Configuration, EspWifi};
use esp_idf_svc::http::server::{EspHttpServer, Configuration as HttpConfig};
use log::*;
use std::sync::{Arc, Mutex};
use std::io::{Read, Write};

mod webapp;

const WIFI_SSID: &str = "Ecco";
const WIFI_PASS: &str = "eccoflip";
const UART_BAUD: u32 = 115200;

fn main() -> Result<()> {
    esp_idf_sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    info!("Ecco ESP32 starting...");

    let peripherals = Peripherals::take()?;
    let sysloop = EspSystemEventLoop::take()?;
    let nvs = EspDefaultNvsPartition::take()?;

    // Set up UART to Flipper (GPIO pins on WiFi dev board)
    let uart = setup_uart(
        peripherals.uart1,
        peripherals.pins.gpio17, // TX
        peripherals.pins.gpio18, // RX
    )?;
    let uart = Arc::new(Mutex::new(uart));

    // Set up WiFi AP
    let _wifi = setup_wifi(peripherals.modem, sysloop, nvs)?;
    info!("WiFi AP started: {} / {}", WIFI_SSID, WIFI_PASS);

    // Set up HTTP + WebSocket server
    let mut server = setup_http_server(uart)?;
    info!("HTTP server started on http://192.168.4.1");

    // Keep alive
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}

fn setup_uart<'a>(
    uart: uart::UART1,
    tx: gpio::Gpio17,
    rx: gpio::Gpio18,
) -> Result<UartDriver<'a>> {
    let config = uart::config::Config::default()
        .baudrate(Hertz(UART_BAUD));

    let driver = UartDriver::new(
        uart,
        tx,
        rx,
        Option::<gpio::Gpio0>::None,
        Option::<gpio::Gpio1>::None,
        &config,
    )?;

    info!("UART initialized at {} baud", UART_BAUD);
    Ok(driver)
}

fn setup_wifi(
    modem: impl esp_idf_hal::peripheral::Peripheral<P = esp_idf_hal::modem::Modem> + 'static,
    sysloop: EspSystemEventLoop,
    nvs: EspDefaultNvsPartition,
) -> Result<EspWifi<'static>> {
    let mut wifi = EspWifi::new(modem, sysloop, Some(nvs))?;

    let ap_config = AccessPointConfiguration {
        ssid: WIFI_SSID.try_into().unwrap(),
        password: WIFI_PASS.try_into().unwrap(),
        auth_method: AuthMethod::WPA2Personal,
        channel: 6,
        max_connections: 4,
        ..Default::default()
    };

    wifi.set_configuration(&Configuration::AccessPoint(ap_config))?;
    wifi.start()?;

    Ok(wifi)
}

fn setup_http_server(uart: Arc<Mutex<UartDriver<'static>>>) -> Result<EspHttpServer<'static>> {
    let config = HttpConfig {
        http_port: 80,
        ..Default::default()
    };

    let mut server = EspHttpServer::new(&config)?;

    // Serve webapp
    server.fn_handler("/", esp_idf_svc::http::Method::Get, |req| {
        req.into_ok_response()?
            .write_all(webapp::INDEX_HTML.as_bytes())?;
        Ok(())
    })?;

    server.fn_handler("/app.js", esp_idf_svc::http::Method::Get, |req| {
        let mut resp = req.into_response(200, None, &[
            ("Content-Type", "application/javascript"),
        ])?;
        resp.write_all(webapp::APP_JS.as_bytes())?;
        Ok(())
    })?;

    server.fn_handler("/style.css", esp_idf_svc::http::Method::Get, |req| {
        let mut resp = req.into_response(200, None, &[
            ("Content-Type", "text/css"),
        ])?;
        resp.write_all(webapp::STYLE_CSS.as_bytes())?;
        Ok(())
    })?;

    // WebSocket endpoint - bridge to UART
    let uart_ws = uart.clone();
    server.ws_handler("/ws", move |ws| {
        info!("WebSocket connected");
        let uart = uart_ws.clone();

        loop {
            // Read from WebSocket
            let mut buf = [0u8; 1024];
            match ws.recv(&mut buf) {
                Ok(len) if len > 0 => {
                    // Forward to UART
                    if let Ok(mut uart) = uart.lock() {
                        if let Err(e) = uart.write_all(&buf[..len]) {
                            error!("UART write error: {:?}", e);
                        }
                    }

                    // Read response from UART and send back
                    if let Ok(mut uart) = uart.lock() {
                        let mut resp = [0u8; 1024];
                        match uart.read(&mut resp) {
                            Ok(n) if n > 0 => {
                                if let Err(e) = ws.send(&resp[..n]) {
                                    error!("WebSocket send error: {:?}", e);
                                    break;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                Ok(_) => break, // Connection closed
                Err(e) => {
                    error!("WebSocket recv error: {:?}", e);
                    break;
                }
            }
        }

        info!("WebSocket disconnected");
        Ok(())
    })?;

    Ok(server)
}
