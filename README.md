# Highlanders 4499 Outreach Kit Robot Code

Drive the outreach kit robot with a joystick in the PestoLink iPhone app.
The robot shows up over Bluetooth as **robotikit**.

This project is set up for the kit's **single-core ESP32-S0WD, with 4 MB flash**.

## Get the code

1. Install [Git](https://git-scm.com/downloads), [VS Code](https://code.visualstudio.com/), and the [PlatformIO extension](https://platformio.org/install/ide?install=vscode).
2. In VS Code, press **Ctrl+Shift+P** and choose **Git: Clone**.
3. Paste `https://github.com/HighlandersFRC/RobotControlBoard.git`.
4. Open the cloned folder containing `platformio.ini`.

## Upload

1. Plug the ESP32 into your computer with a USB data cable.
2. Open the PlatformIO sidebar (alien-head icon).
3. Expand **Project Tasks → pesto_test → General** and click **Upload**.
   This builds the code and uploads it. The first build can take several minutes.
4. After it says **SUCCESS**, open **Monitor** for serial output at **115200 baud**.

If uploading gets stuck at `Connecting...`, hold **BOOT** until writing starts.
There is one program in this repo, so the toolbar Upload button uses it too.
For later edits, use Upload directly. Keep `.pio/` between builds; using **Clean**
or deleting it forces the framework to compile again.

## Drive

1. Connect the motors to the board's **M1** and **M2** outputs and turn on the kit's motor supply.
2. Open the PestoLink iPhone app, allow Bluetooth access, and connect to **robotikit**.
3. Choose **Joystick (axes 0, 1)**. Up/down drives forward/backward; left/right steers.

Centering the joystick stops the motors. They also stop when Bluetooth disconnects
or no controller packet arrives for 500 ms. USB power alone does not power the motors.

## Make changes

All robot code is in [`src/main.cpp`](src/main.cpp). The settings at the top control
pins, joystick deadband, speed limit, and motor direction. Set `MAX_DRIVE_POWER`
to `0.5f` for half power, or change `INVERT_MOTOR_ONE` / `INVERT_MOTOR_TWO` if a motor
turns the wrong way. Build and upload again after editing.

| Motor signal | GPIO |
| --- | --- |
| M1 PWM / direction | 18 / 19 |
| M2 PWM / direction | 16 / 17 |
| Shared driver enable | 23 |

`platformio.ini` selects the board and dependencies. `config/esp32.defaults` holds
the single-core and Bluetooth settings. Keep both CMake files: this chip needs
Arduino compiled with ESP-IDF, and the root file fixes a BLE header conflict.

`lib/PestoLink-Receive` contains [PestoLink](https://github.com/AlfredoSystems/PestoLink-Receive)
with a small task change for the single-core chip. Build files and downloaded
dependencies stay in `.pio/` and are ignored by Git.
