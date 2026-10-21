# PestoLink single-core adaptation

Source: https://github.com/AlfredoSystems/PestoLink-Receive/tree/bdef7bf367c1ea1a0f9c1649d55f2cb5259ad924

This local copy retains the upstream license and code. In `PestoLinkParser::begin`, the background task uses `xTaskCreate` instead of `xTaskCreatePinnedToCore(..., 1)`. This allows it to run on the ESP32-S0WD's only CPU core. Task creation failure is reported through `begin()` returning false.

Keep this folder under `lib/`. Do not add a second remote copy of PestoLink to `lib_deps`. ArduinoBLE is provided by the exact version in `platformio.ini`.
