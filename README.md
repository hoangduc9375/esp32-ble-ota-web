# ESP32-C3 BLE OTA Web Uploader

Mobile-first Web Bluetooth uploader for the custom `esp32-lin-logger` OTA
service used by the dual-TJA1021 LIN gateway.

## Use

1. Build the ESP32 firmware with PlatformIO.
2. Copy `firmware.bin` to an Android phone.
3. Open the GitHub Pages URL in Chrome Android.
4. Tap **Kết nối ESP32** and select `esp32-lin-logger`.
5. Select `firmware.bin`, then start the upload.
6. Keep the ESP32 powered until the page reports success and reboot.

The selected firmware stays in the browser and is transferred directly over
Bluetooth LE. It is not uploaded to GitHub or another server.

## Compatibility

- Device name: `esp32-lin-logger`
- OTA service: `7f1d0001-8e8f-4c4b-9d59-1a3d862df201`
- Chrome Android with Web Bluetooth

MD5 provides transfer-integrity checking only. It does not authenticate the
firmware author, so only install binaries from a trusted build.
