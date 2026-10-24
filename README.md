# Highlanders 4499 Outreach Kit Robot Code

PlatformIO firmware for the Highlanders 4499 outreach kit. Each robot has its own build environment under **Project Tasks**.

## Open and upload

1. Open the cloned folder containing `platformio.ini` in VS Code.
2. Open the PlatformIO sidebar and expand **Project Tasks**.
3. Pick a robot below, then click **General → Upload**.
4. Open that environment's **Monitor** at 115200 baud for status messages.

The first build downloads the ESP32 toolchain and can take several minutes. Keep `.pio/` between builds so later builds can reuse compiled files.

## Robot programs

| Environment | Program | Behavior |
| --- | --- | --- |
| `front_loader` | `src/Front-Loader/FrontLoader.cpp` | PestoLink joystick drive as **robotikit**. Button 1 toggles the intake servo down/up; button 2 is unused. |
| `balancing_robot` | `src/Balancing-Robot/BalancingRobot.cpp` | LSM6DS3 roll PID; connect to **BalanceBot** and press button 0 to arm/disarm. |
| `butterfly` | `src/Butterfly-Kit/butterfly.cpp` | M1 runs continuously at 50% output. No PestoLink connection is used. |
| `dragon` | `src/Dragon-Kit/dragon.cpp` | M1 and M2 run continuously at 50% output. No PestoLink connection is used. |

The Butterfly and Dragon motors start automatically when the board is powered and keep running until power is removed. Raise the robot wheels before testing. Their example power is set near the top of each source file.

For Front Loader, connect to **robotikit** in the PestoLink iPhone app and choose joystick axes 0 and 1. Centering the joystick stops the motors; they also stop if Bluetooth disconnects or controller data is stale. Press button 1 once to move the intake down; press it again to move it up. The servo starts in its up position and travels faster than the earlier version.

For Balancing Robot, SDA is GPIO 21 and SCL is GPIO 22. The complementary filter combines roll from the accelerometer and gyro. Check the roll and motor direction with wheels raised before trying to balance on the floor. The PID gains are starting values and may need tuning for the robot.

## Shared motor pins

| Signal | GPIO |
| --- | ---: |
| M1 PWM / direction | 18 / 19 |
| M2 PWM / direction | 16 / 17 |
| Shared driver enable | 23 |

`platformio.ini` selects the board and dependencies. `config/esp32.defaults` holds
the single-core and Bluetooth settings. Keep both CMake files: this chip needs
Arduino compiled with ESP-IDF, and the root file fixes a BLE header conflict.

`lib/PestoLink-Receive` contains [PestoLink](https://github.com/AlfredoSystems/PestoLink-Receive)
with a small task change for the single-core chip. Build files and downloaded
dependencies stay in `.pio/` and are ignored by Git.

## If the first build fails

PlatformIO downloads CMake and the ESP32 build tools automatically. If the build
reports `Could not find CMAKE_ROOT`, PlatformIO's local CMake download is
incomplete. Close VS Code, delete the `tool-cmake` folder inside
`%USERPROFILE%\.platformio\packages`, reopen the project, and build again.
This folder is part of PlatformIO's local installation, not this repository, so
cloning the project does not copy it. The `.pio/` folder in the project is also
generated locally and is not included in Git.
