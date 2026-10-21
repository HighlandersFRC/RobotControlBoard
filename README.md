# Highlanders 4499 Outreach Kit Robot Code

Joystick motor control for the **Highlanders 4499 Outreach Kit Robot**, using the PestoLink iPhone app and Bluetooth Low Energy.

This PlatformIO project uses the Arduino framework with ESP-IDF to support the **ESP32-S0WD single-core chip**. It advertises as **robotikit** and controls the board's M1 and M2 motor outputs from one joystick.

## Open the project in VS Code

1. Install [Visual Studio Code](https://code.visualstudio.com/) and the [PlatformIO IDE extension](https://platformio.org/install/ide?install=vscode).
2. In VS Code, press **Ctrl+Shift+P** and choose **Git: Clone**. Git must be installed for this command to be available.
3. Paste `https://github.com/HighlandersFRC/RobotControlBoard.git` and choose a local folder.
4. Open the cloned **RobotControlBoard** folder. The folder containing `platformio.ini` must be the workspace root.
5. Allow PlatformIO to initialize the project and install its dependencies. The first build also compiles ESP-IDF and Arduino, so it can take several minutes.

The included configuration targets an **ESP32-S0WD with 4 MB flash**, running at 160 MHz. The PlatformIO board ID is `esp32dev`; `sdkconfig.defaults` enables the single-core build. Keep `framework = arduino, espidf` for this chip so the framework is compiled for its one CPU core.

## Build and upload

This repository contains one program:

| Environment | Source file | Purpose |
| --- | --- | --- |
| `pesto_test` | [`src/main.cpp`](src/main.cpp) | PestoLink joystick control of M1 and M2 |

1. Connect the ESP32 to the computer with a **USB data cable**.
2. Click the PlatformIO alien-head icon in VS Code.
3. Expand **Project Tasks → pesto_test → General**.
4. Click **Build** and wait for **SUCCESS**.
5. Click **Upload** under the same environment. If it waits at `Connecting...`, hold the board's **BOOT** button until writing begins, then release it.
6. Click **Monitor** under the same environment. The serial speed is **115200 baud**. Press **EN/RESET** if you missed the startup messages.

`pesto_test` is the default environment, so the PlatformIO toolbar also builds and uploads this program. Each upload replaces the program previously stored on the ESP32.

After initialization succeeds, the Serial Monitor prints:

```text
PestoLink started. Connect to robotikit in the iPhone app.
Joystick axes 0/1: forward/reverse and steering.
```

## Connect and drive with PestoLink

1. Connect a motor to the board's **M1 motor output**. Connect a second motor to **M2** if the robot uses two motors.
2. Power the motor board from the kit's motor supply. The USB connection powers the ESP32 but does not replace the motor supply.
3. Open the **PestoLink iPhone app**, enable Bluetooth, and allow the app's Bluetooth permission.
4. Tap the app's connection button and select **robotikit**.
5. Open the controller screen and select **Joystick (axes 0, 1)**.

| Joystick or connection state | Behavior |
| --- | --- |
| Up / down | Forward / reverse |
| Left / right | Steering; with no forward input, the motors turn in opposite directions |
| Centered | Both motors stop |
| Bluetooth disconnected | Both motors stop |
| No new controller packets for more than 500 ms | Both motors stop |

The Serial Monitor reports controller connection changes. Button **0** prints `Button 0 was pressed!` once per press, which can help confirm that the app is sending input.

For the web version and supported browsers, see [PestoLink](https://pestol.ink/) and its [official project page](https://github.com/AlfredoSystems/PestoLink-Online#browser-support).

## Motor pins and settings

The pin assignments and motor output formulas come from the outreach kit's supplied sample code.

| Signal | ESP32 GPIO |
| --- | --- |
| M1 enable / PWM | 18 |
| M1 phase / direction | 19 |
| M2 enable / PWM | 16 |
| M2 phase / direction | 17 |
| Shared motor-driver sleep / enable | 23 |

The driver is disabled at startup and whenever controller input is unavailable. A small joystick deadband prevents movement near the center position. Forward input and steering are mixed and scaled to keep both motor commands within their allowed range.

The settings near the top of `src/main.cpp` are:

| Setting | Default | Use |
| --- | --- | --- |
| `MAX_DRIVE_POWER` | `1.0f` | Maximum output; use `0.5f` for a 50% limit |
| `INVERT_MOTOR_ONE` | `false` | Set to `true` to reverse M1's physical direction |
| `INVERT_MOTOR_TWO` | `false` | Set to `true` to reverse M2's physical direction |
| `JOYSTICK_DEADBAND` | `0.08f` | Ignore small input near the joystick center |
| `COMMAND_TIMEOUT_MS` | `500` | Stop after this long without a new controller packet |

Rebuild and upload after changing these settings.

## Project layout

```text
RobotControlBoard/
├── README.md
├── platformio.ini              Platform, environment, and ArduinoBLE dependency
├── sdkconfig.defaults         Single-core, Bluetooth, clock, and flash settings
├── CMakeLists.txt              ESP-IDF project setup and BLE header fix
├── src/
│   ├── CMakeLists.txt          Selects main.cpp for compilation
│   └── main.cpp               Bluetooth and joystick motor control
└── lib/
    └── PestoLink-Receive/      Pinned PestoLink source with the single-core fix
```

ArduinoBLE **2.1.0** installs automatically from `platformio.ini`. PestoLink is included locally because its background task has been adapted to work on the S0WD's single CPU core. Keep the `lib/PestoLink-Receive` folder when cloning or copying this project. Its upstream license and [local change notes](lib/PestoLink-Receive/LOCAL_CHANGES.md) are included.

The root CMake file also prevents Espressif's bundled BLE headers from shadowing ArduinoBLE's headers in this Arduino + ESP-IDF build. The Bluetooth configuration uses **Controller Only** because ArduinoBLE supplies the host stack.

Build output, downloaded libraries, editor caches, and generated `sdkconfig.pesto_test` files are ignored by Git. They are recreated locally when PlatformIO builds the project.

## Troubleshooting

| Problem | Next step |
| --- | --- |
| PestoLink keeps searching for robots | Confirm the upload succeeded, reset the board, and check the Serial Monitor for the startup message. Check Bluetooth permission for PestoLink and search for **robotikit**. |
| Motors do not move | Confirm the controller connection message appears, choose joystick axes **0/1**, and check the motor supply and board motor connections. |
| One motor turns the wrong way | Change its `INVERT_MOTOR_...` setting, rebuild, and upload. |
| Reboot log says the chip is single-core but the application is multi-core | Confirm that this project is open and `framework = arduino, espidf` is selected. Regenerate the configuration using the steps below. |
| Bluetooth is disabled or flash size is still 2 MB | Regenerate the configuration from the included `sdkconfig.defaults`. |
| `BLEDeviceEvent` or incomplete `BLEDevice` compiler errors | Keep the supplied root `CMakeLists.txt`, local PestoLink library, and ArduinoBLE 2.1.0 dependency together. |

To regenerate old configuration in VS Code:

1. Finish or stop active builds and close the Serial Monitor.
2. In Explorer, rename `sdkconfig.pesto_test` to `sdkconfig.pesto_test.old` if it exists.
3. Rename `.pio/build/pesto_test` to `pesto_test-old` if it exists.
4. Run **Project Tasks → pesto_test → General → Build**, then **Upload** again.

The regenerated configuration should contain `CONFIG_FREERTOS_UNICORE=y`, `CONFIG_FREERTOS_HZ=1000`, `CONFIG_BT_ENABLED=y`, `CONFIG_BT_CONTROLLER_ONLY=y`, and `CONFIG_ESPTOOLPY_FLASHSIZE="4MB"`.

## Validation

A fresh build of the `pesto_test` environment completed successfully with this source and configuration. Bluetooth pairing and motor direction still need to be checked on the physical kit robot.
