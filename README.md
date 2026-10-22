# BUDX

A browser controller and Arduino firmware for the BUDX robot arm.

## Repository layout

```text
app/                          Web controller
  src/                        Interface, 3D arm, motion, and device input
  public/                     CAD models and local Draco decoder
  tests/                      Controller regression tests
  scripts/                    Browser checks
  README.md                   App controls and development guide
hardware/
  arduino_control/
    arduino_control.ino       Original five-servo PCA9685 sketch
  README.md                   Firmware setup and serial commands
.github/workflows/check.yml   App tests and production build
netlify.toml                  Netlify build paths
```

## Run the app

Use Node.js 20.19+ or 22.12+; Node 22 LTS is recommended.

```sh
cd app
npm ci
npm run dev
```

Open the local address printed by Vite. The app supports posing the four-axis model, recording and replaying movement, camera and gamepad input, collapsible controls, and saved appearance settings. See the [app guide](app/README.md) for all controls and device behavior.

Run checks and build from `app/`:

```sh
npm test
npm run build
npm run preview
```

The production output is `app/dist/`. Netlify and GitHub Actions are configured to build from `app/`.

## Set up the hardware

Open [arduino_control.ino](hardware/arduino_control/arduino_control.ino) in Arduino IDE. The sketch is preserved unchanged from the supplied [BUD-Controller source](https://github.com/httpsHavshSer1/BUD-Controller/blob/bb2ee22a21c11dbd5796ded424afcb8dfd5395d1/arduino_control.ino). It drives PCA9685 channels 0–4 at 60 Hz and accepts single-letter commands over USB serial at 115200 baud.

Follow the [hardware guide](hardware/README.md) for the library, connections, upload steps, and command table. The sketch centers all five servos when it starts; check the pulse limits against your arm before powering the servos.

## App and firmware compatibility

The supplied sketch and the app currently use different serial protocols. The sketch accepts letters such as `a`, `d`, and `c`. The web app sends four absolute joint targets, such as `S0:90,S1:108,S2:90,S3:90`, followed by a newline. Connecting them at the same baud rate does not translate those commands.

Use this sketch through Arduino Serial Monitor for manual control. Direct web control requires firmware that implements the app's four-joint target protocol, or an explicit protocol adapter. The included sketch has five servo channels; the app models four joints, so the fifth channel also needs a defined mapping before integration.
