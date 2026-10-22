# BUDX controller

A browser workbench for the four-axis BUDX arm. Pose the model directly, record movements into three local slots, or connect a gamepad, Arduino, or camera.

## Run it

Use Node 20.19+ or 22.12+ (Node 22 LTS recommended).

```sh
npm ci
npm run dev
```

Open the localhost address printed by Vite. For a production build, run `npm run build`, then `npm run preview`. Serve `dist/` over HTTPS when deploying. For a subdirectory, build with `npm run build -- --base=/your-path/`.

## Controls

| Input | Action |
| --- | --- |
| Joint slider or angle field | Set a joint angle |
| Drag a model part | Move that joint |
| Drag the background | Orbit the camera |
| Scroll / pinch | Zoom |
| Shift + click the ground | Move toward a target, within joint limits |
| 1–4 | Select a joint |
| Left / right arrow | Move the selected joint by 1°; hold Shift for 5° |
| F | Fit the current pose in view |
| Escape / Stop motion | Stop playback and control input at the current pose |
| Fullscreen button | Expand the model viewer; Escape or the exit button returns to the workbench |
| Snow checkbox | Toggle the falling snow; the preference is saved locally |

Manual movement takes over from playback and unchecks **Move arm with hand**. Hand and serial input do not interrupt playback. To return to hand control, check that option again. Stop motion pauses serial input until a new manual movement or playback action. A gamepad must return to neutral before it can move the arm again.

Stop motion stops this app's commands; it does not send a hardware emergency-stop packet. The existing Arduino protocol only carries position targets. A controller that has already received a target may continue moving toward it.

Recordings last up to one minute. **Save recording**, changing slots, or stopping saves the current recording. Recordings stay in this browser's local storage under the existing `budx-anim-slots` key, and older valid recordings are supported. Storage failures leave the recording usable for the current session and show a status message.

## Devices

**Gamepad:** Connect a standard gamepad and press a button. Left stick orbits; right stick X moves the selected joint and Y zooms. LB/RB select joints, A returns home, Y fits the camera, X plays/stops, Start records/saves, and D-pad up/down/left starts Wave/Sweep/Salute. Motion speed is independent of the display refresh rate.

**Arduino:** Chrome or Edge on localhost/HTTPS is required for Web Serial. The baud rate and line protocol are unchanged:

```text
Browser → Arduino: S0:90,S1:108,S2:90,S3:90\n
Arduino → browser: P0:90,P1:108,P2:90,P3:90\n
Camera orbit:      DX:20,DY:-10\n
```

Servo positions map 0–180 to each joint's allowed range. Output is coalesced to at most 20 messages per second, and browser-originated writes suppress incoming position echoes for 500 ms. Invalid fields are ignored and values are clamped. Browser writes are awaited before the writer lock is released. Confirm physical joint calibration in your firmware before connecting the arm; the simulator does not model collisions or hardware feedback.

**Camera:** Enable the camera explicitly. Tracking assets are downloaded from pinned MediaPipe packages on jsDelivr only when needed; video processing runs locally. Smooth motion is enabled by default. Face blur affects the local preview only. Denied permissions, missing cameras, failed downloads, and tracking failures release the camera and show a useful error. Hiding the tab stops motion and releases the camera. Camera access and real Arduino/gamepad operation need verification on your hardware.

## Arm geometry

The four original glTF exports use a shared CAD origin, metres, and Z up. `src/arm/rig.js` converts that coordinate system once, defines the actual bearing heights, and offsets each mesh back around its own pivot. Shoulder and elbow rotations therefore keep their mating bearing centers coincident. The elbow socket export sits 2.032 mm above the upper arm's bearing center; the mount corrects that offset.

The original wrist pivot had no mesh. A small procedural tool flange now makes wrist roll visible and remains attached to the forearm. It represents a tool mount, not an additional supplied CAD part. Joint ranges remain turntable ±180°, shoulder −90° to 60°, elbow ±90°, and wrist ±60°.

`src/arm/kinematics.js` uses these same link dimensions and joint limits for inverse kinematics. Targets outside the workspace produce the nearest pose found by the limited solver, with a visible message.

## Code and checks

The dark interface uses a web adaptation of the [Apple Liquid Glass skill](https://github.com/haider-nawaz/liquid-glass-skill). The reference targets native SwiftUI; this app keeps its JavaScript/Three.js stack. Clear graphite control panels float above the continuous scene and snow, with shared backdrop sampling and locally generated edge refraction. Controls inside a panel use ordinary painted surfaces. The model's framing accounts for the sidebars so it remains centered in the usable space. There are no extra dependencies or downloaded visual assets.

The bottom-right transparency button switches to an opaque appearance and remembers the choice in this browser. System Reduce Transparency, increased contrast, and forced colors take priority. Reduce Motion disables refractive effects and transitions; small screens use blur without SVG refraction. `src/liquid-glass.js` generates edge maps on resize, updates the camera selector, and cleans up observers on disposal. `src/styles/liquid-glass.css` contains the appearance and fallback rules.

`src/fullscreen.js` expands the model viewer using native fullscreen, with an in-page fallback when embedded browsers reject or stall the native request. Both modes provide an exit button, Escape handling, focus containment, and restored joint controls on exit. `src/snow.js` simulates up to 900 world-space flakes (520 on initial mobile load) in the same WebGL scene as the arm. Flakes have perspective sizing, depth occlusion, tumble, and local pointer-driven gusts. Move or click through the scene to stir them. Snow pauses when the tab is hidden or Reduce Motion is enabled.

There is no branded header. Controls and Devices toggle independent sidebars and remember desktop preferences; mobile opens with the scene and shows one panel at a time. Home and Stop remain visible. The model uses charcoal metal and room reflections, and the ground grid uses four-unit cells (80 mm at the existing display scale).

`PRODUCT.md` records the confirmed personal robot-controller context. Impeccable's project design detector is enabled in `.impeccable/config.json`; machine-local consent stays ignored.

- `src/arm/`: geometry calibration, model loading, and inverse kinematics.
- `src/viewport.js`: rendering, camera, picking, and pointer interaction.
- `src/motion.js`: recording, validation, persistence, and playback.
- `src/inputs/`: gamepad, serial, and camera lifecycles.
- `src/ui.js`: DOM bindings and display updates.
- `src/main.js`: input ownership and application lifecycle.

```sh
npm test
npm run build
```

Tests cover CAD bearing calibration, attachment through the joint ranges, wrist rotation, inverse kinematics, shared limits, recording persistence and malformed storage, serial parsing, and asynchronous write ordering. GitHub Actions runs tests and the build on pushes and pull requests.

For the browser smoke check, start the dev server and run these commands in another terminal. This uses Playwright CLI and synthetic video, without requesting a physical device. Screenshots are written to the ignored `output/playwright/` directory. Run it in a fresh browser profile: it writes a test recording to Slot 1.

```sh
npx --yes --package @playwright/cli playwright-cli open http://localhost:5173 --headed
npx --yes --package @playwright/cli playwright-cli run-code --filename=scripts/browser-check.js
npx --yes --package @playwright/cli playwright-cli run-code --filename=scripts/glass-check.js
npx --yes --package @playwright/cli playwright-cli run-code --filename=scripts/viewer-check.js
npx --yes --package @playwright/cli playwright-cli run-code --filename=scripts/scene-check.js
```

Draco decoding is served locally from `public/draco/`; it does not depend on a third-party CDN to display the arm. See `public/draco/LICENSE` for the decoder license.
