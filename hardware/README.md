# Arduino controller

[`arduino_control/arduino_control.ino`](arduino_control/arduino_control.ino) is an unchanged copy of the supplied [BUD-Controller sketch](https://github.com/httpsHavshSer1/BUD-Controller/blob/bb2ee22a21c11dbd5796ded424afcb8dfd5395d1/arduino_control.ino), from commit `bb2ee22a21c11dbd5796ded424afcb8dfd5395d1`. Its containing folder matches the sketch name so it opens directly in Arduino IDE.

## What you need

- An Arduino-compatible board with USB serial and I2C.
- A PCA9685 PWM servo driver, connected at the Adafruit library's default I2C address.
- Up to five servos on channels 0–4 and a servo power supply appropriate for those servos.
- Arduino IDE, your board's installed support package, and the **Adafruit PWM Servo Driver Library**. Install the library and its requested dependencies through [Library Manager](https://docs.arduino.cc/software/ide-v2/tutorials/ide-v2-installing-a-library/). `Wire` is provided by the board package.

The source does not specify an Arduino model, servo models, or mechanical channel assignments. Select the actual board and establish the channel-to-joint mapping for your arm.

## Connections

Connect the board's SDA and SCL to the driver's SDA and SCL, share ground, and connect VCC to the board's appropriate logic supply. Supply the servos separately through the driver's V+ power input; VCC powers the driver logic. Connect the servo leads with the driver's marked polarity and signal orientation. Use [Adafruit's wiring and power guide](https://learn.adafruit.com/16-channel-pwm-servo-driver/hooking-it-up) for your board and power supply.

## Upload and use

1. Open `hardware/arduino_control/arduino_control.ino` in Arduino IDE.
2. Select your board and USB port, then Verify and Upload.
3. Open Serial Monitor at **115200 baud** with **No line ending**.
4. Send a command from the table below. Each received letter applies one step; send it again for another step.

The firmware immediately writes `CENTER` to all five channels at startup, and repeats that whenever you send `c`. Confirm the pulse range and starting pose before applying servo power. The sketch does not print position feedback or command acknowledgments.

| Command | PCA9685 channel | Change in PWM counts |
| --- | --- | --- |
| `a` / `d` | 0 | −20 / +20 |
| `w` / `s` | 1 | +3 / −3 |
| `q` / `e` | 2 | −15 / +15 |
| `j` / `l` | 3 | −25 / +25 |
| `u` / `i` | 4 | +15 / −15 |
| `c` | All five | Set to 375 |

## Firmware settings

| Setting | Supplied value |
| --- | --- |
| Serial baud rate | 115200 |
| PWM frequency | 60 Hz |
| `SERVO_MIN` | 150 counts |
| `SERVO_MAX` | 600 counts |
| `CENTER` | 375 counts |

These values are PCA9685 PWM counts, not degrees or microseconds. The sketch clamps each position to 150–600 counts. Calibrate these limits for the actual servos and mechanism; the constants alone do not establish safe mechanical joint limits.

## Connecting to the web app

The [web app](../app/README.md) sends newline-terminated absolute targets for four joints:

```text
S0:90,S1:108,S2:90,S3:90
```

Its optional incoming position format is `P0:90,P1:108,P2:90,P3:90`. The supplied sketch only reads individual letters and does not implement either format. It has been included as requested, without changing its behavior. Use Serial Monitor with this firmware; direct browser control needs compatible firmware or a protocol adapter, plus a decision about the fifth servo.

Close Serial Monitor before opening the same USB port from another application.
