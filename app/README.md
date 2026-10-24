# BUDX controller

A browser workbench for the BUDX arm: turntable, shoulder, elbow, and replacement claw. Pose the model directly, record movements into three local slots, or connect a gamepad, Arduino, or camera.

The opening view shows the folded arm at −116.6° turntable, 60° shoulder, 61.4° elbow, and 50% claw opening, with the wider Perspective framing and tool arrows hidden. Use Move arm handles to show the arrows. Home returns the three arm joints to zero and the claw to half open; Fit view frames the current pose. Saved theme and panel preferences remain in effect.

## Run it

Run these commands from this `app/` directory. The serial bridge below works with the supplied Arduino sketch without changing it.

Use Node 20.19+ or 22.12+ (Node 22 LTS recommended).

```sh
npm ci
npm run dev
```

Open the localhost address printed by Vite. For a production build, run `npm run build`, then `npm run preview`. Serve `dist/` over HTTPS when deploying. For a subdirectory, build with `npm run build -- --base=/your-path/`.

## Controls

| Input | Action |
| --- | --- |
| Joint slider or angle field | Request a joint angle; Claw uses 0% closed to 100% open |
| Drag the claw or its position arrows | Move the whole arm toward the tool position |
| Drag another model part | Move that joint |
| Move arm handles button | Show/hide tool arrows; while focused, arrow keys move the tool and Page Up/Down adjusts depth |
| Drag the background | Orbit the camera |
| Scroll / pinch | Zoom |
| Shift + click the ground | Move toward a target, within joint limits |
| 1–4 | Select a joint |
| Left / right arrow | Request 1° on an arm joint or 1% claw opening; hold Shift for 5 steps |
| F | Fit the current pose in view |
| Escape / Stop motion | Stop playback and control input at the current pose |
| Fullscreen button | Expand the model viewer; Escape or the exit button returns to the workbench |
| Snow checkbox | Toggle the falling snow; the preference is saved locally |

All app-controlled movement passes through `src/movement.js`: each control changes by at most 15 internal degrees per second (12.5 percentage points per second for Claw), including sliders, typing, keyboard, model dragging, inverse kinematics, controller, hand tracking, Home, and playback. A delayed animation frame cannot cause a catch-up jump. Controller input is also reduced to 0.22 radians per second. Playback speed settings cannot bypass this limit; reaching a distant final pose can take longer than the recorded timeline.

Manual movement takes over from playback and unchecks **Move arm with hand**. Checking that option explicitly takes ownership from playback; unchecking it, losing the tracked hand, or stopping the camera cancels any pending hand destination. Stop cancels the model destination and all unsent serial steps. A gamepad must return to neutral before it can move again. A serial letter already accepted by the port cannot be retracted; the sketch has no hardware emergency-stop command.

Recordings last up to one minute. **Save recording**, changing slots, or stopping saves the current recording. Recordings stay in this browser's local storage under the existing `budx-anim-slots` key, and older valid recordings are supported. Storage failures leave the recording usable for the current session and show a status message.

## Devices

**Gamepad:** Connect a standard gamepad and press a button. Left stick orbits; right stick X moves the selected joint and Y zooms. LB/RB select joints, A returns home, Y fits the camera, X plays/stops, Start records/saves, and D-pad up/down/left starts Wave/Sweep/Salute. Motion speed is independent of the display refresh rate.

**Arduino:** Chrome or Edge on localhost/HTTPS is required for Web Serial at 115200 baud. The app sends the unchanged sketch's single-letter commands:

| App control | PCA9685 channel | Decrease / increase | Firmware pulse step |
| --- | --- | --- | --- |
| Turntable | 0 | `a` / `d` | 20 |
| Shoulder | 1 | `s` / `w` | 3 |
| Elbow | 2 | `q` / `e` | 15 |
| Claw | 4 | `i` / `u` | 15 |

Channel 3 is left alone: the app never sends `j`, `l`, `S3` targets, or the all-channel center command `c`. **Single letters (repo sketch)** is the default command format. In that mode, the bridge sends one awaited letter at a time, without newlines or numeric targets, at least 100 ms apart globally, with per-axis intervals based on the sketch's actual step sizes and a 30-pulse-per-second budget. It keeps the latest destination, gives all axes a turn, clamps estimated pulses to 150–600, and avoids oscillating between adjacent steps. A failed write suspends output until reconnection.

After opening USB serial, the app waits two seconds for Arduino startup before enabling output. Input made during that wait is discarded so it cannot move the arm later. Once connected, the Arduino panel shows the count of completed browser writes and the most recent joint/letter. This confirms browser output, not receipt or physical movement: the sketch sends no acknowledgements. Changes below half a firmware step produce no letter until enough movement accumulates (about 8° turntable, 0.5° shoulder, 3° elbow, or 1.7% claw opening).

If the previous app's sliders moved the physical arm but single letters do not, disconnect and select **Position lines (compatibility)** under **Command format**, then reconnect. This sends the previous app's newline-terminated `S<channel>:<0–180>` syntax, with the replacement claw routed to `S4` instead of the former wrist's `S3`. The supplied repo sketch does not parse this format; it is for controllers running position-command firmware. Such firmware must support `S4` to control the claw. The app cannot identify the running firmware from successful USB writes alone and never switches formats automatically.

Position compatibility uses the current screen pose as a relative reference for servo positions of 90° on connection. It emits no target until fresh input, changes each servo target by at most 1° per write (at most 10°/second), and shares the existing slow model movement, startup wait, write serialization, Stop cancellation, and error handling. A message looks like `S0:90,S1:90,S2:90,S4:91` followed by a newline. The Arduino panel counts these writes and shows the latest raw line in the counter's tooltip. Change formats only while disconnected; the choice is remembered in this browser. The sketch remains unchanged.

The sketch has no position feedback. Reset the Arduino to its sketch-defined center before connecting. The app assumes 375 pulses on each controlled servo and treats the current on-screen pose as a relative reference; connecting sends no movement or automatic centering. A full on-screen range corresponds to 450 pulse counts relative to that reference. Stop rebases the estimate to discard unsent steps. The model is a command preview, not a measured hardware pose. Diagnostic serial text is drained without changing the model or hand-control checkbox. Hardware limits and the sketch's coarse step sizes remain unchanged.

**Camera:** Enable camera starts a preview only. Check **Move arm with hand** to move the arm; curl the index finger to close the claw and extend it to open. Manual input and Stop uncheck the option. Camera shutdown, disconnection, and failures reset and disable it; restarting remains preview only. Old camera results and late permission responses cannot re-arm movement. Startup and shutdown cannot overlap. Tracking assets are downloaded from pinned MediaPipe packages on jsDelivr only when needed; video processing runs locally. Smooth motion is enabled by default and the shared movement cap applies even when smoothing is off. Face blur affects only the preview. Hiding the tab stops movement and releases the camera.

## Arm geometry

The four original glTF exports use a shared CAD origin, metres, and Z up. `src/arm/rig.js` converts that coordinate system once, defines the actual bearing heights, and offsets each mesh back around its own pivot. Shoulder and elbow rotations therefore keep their mating bearing centers coincident. The elbow socket export sits 2.032 mm above the upper arm's bearing center; the mount corrects that offset.

The replacement claw has two procedural jaws attached to a stationary forearm mount. Claw opening changes jaw separation without rotating the former wrist axis or changing the tool center. Arm ranges remain turntable ±180°, shoulder −90° to 60°, and elbow ±90°. Claw displays 0–100%; its internal −60° to 60° scalar retains the existing four-value recording format, with zero representing half open.

`src/arm/kinematics.js` uses these same link dimensions and joint limits for inverse kinematics. Targets outside the workspace produce the nearest pose found by the limited solver, with a visible message.

The position arrows at the claw move the tool along a world axis; the center handle and claw drag across the camera plane. The first three joints follow while claw opening stays unchanged. The solver chooses a nearby solution on either side of the shoulder to avoid flips during small movements. All movement remains rate limited. Stop or Escape cancels the destination. The Claw slider adjusts opening independently. Keyboard movement from Move arm handles requests 3 mm steps, or 15 mm with Shift.

## Code and checks

The interface uses a web adaptation of the [Apple Liquid Glass skill](https://github.com/haider-nawaz/liquid-glass-skill). The reference targets native SwiftUI; this app keeps its JavaScript/Three.js stack. Clear control panels float above the continuous scene and snow, with shared backdrop sampling and locally generated edge refraction. Controls inside a panel use ordinary painted surfaces. The model's framing accounts for the sidebars so it remains centered in the usable space. There are no extra dependencies or downloaded visual assets.

The bottom-right transparency button switches to an opaque appearance and remembers the choice in this browser. System Reduce Transparency, increased contrast, and forced colors take priority. Reduce Motion disables refractive effects and transitions; small screens use blur without SVG refraction. `src/liquid-glass.js` generates edge maps on resize, updates the camera selector, and cleans up observers on disposal. `src/styles/liquid-glass.css` contains the appearance and fallback rules.

`src/fullscreen.js` expands the model viewer using native fullscreen, with an in-page fallback when embedded browsers reject or stall the native request. Both modes provide an exit button, Escape handling, focus containment, and restored joint controls on exit. `src/snow.js` simulates up to 5,200 world-space flakes (3,000 on initial mobile load) in the same WebGL scene as the arm. Flakes have perspective sizing, depth occlusion, tumble, and local pointer-driven gusts. Soft forces divert flakes around the moving arm links, and a feathered screen-space fade keeps the model readable from every camera angle. Move or click through the scene to stir them. Snow pauses when the tab is hidden or Reduce Motion is enabled.

There is no branded header. Controls and Devices toggle independent sidebars and remember desktop preferences; mobile opens with the scene and shows one panel at a time. Home and Stop remain visible. Joint rows show a name, angle, and slider; recording slots and playback settings live under Recording options. The camera preview and hand controls appear only while tracking is active. Panel dimensions are unchanged. The model changes between graphite and brushed aluminum with neutral lighting, and the ground grid uses four-unit cells (80 mm at the existing display scale).

The sun/moon button at the bottom right switches between the original deep charcoal Dark mode and the brighter slate Light mode. The arm changes from graphite to muted brushed aluminum, and Light mode’s matte ground shares the arm’s base color with reduced glare and darker grid lines. The choice is saved locally and synchronized across open tabs. Palette tokens in `src/styles/liquid-glass.css` drive the controls, page, arm materials, WebGL floor, grid, fog, and snow; changing themes preserves the current pose. `src/theme.js` manages the toggle, storage fallback, and browser chrome color.

`PRODUCT.md` records the confirmed personal robot-controller context. Impeccable's project design detector is enabled in `.impeccable/config.json`; machine-local consent stays ignored.

- `src/arm/`: geometry calibration, model loading, and inverse kinematics.
- `src/viewport.js`: rendering, camera, picking, and pointer interaction.
- `src/motion.js`: recording, validation, persistence, and playback.
- `src/movement.js`: shared movement-rate limit and destination cancellation.
- `src/inputs/`: gamepad, serial, and camera lifecycles.
- `src/ui.js`: DOM bindings and display updates.
- `src/main.js`: input ownership and application lifecycle.

```sh
npm test
npm run build
```

Tests cover CAD bearing calibration, claw separation and stationary mounting, inverse kinematics, shared speed limits, recording persistence, actual letter/channel mappings and pacing, asynchronous serial writes and Stop, camera opt-in, startup cancellation, stale tracking results, disconnection, and rapid restarts. GitHub Actions runs tests and the build on pushes and pull requests.

For the browser smoke check, start the dev server and run these commands in another terminal. This uses Playwright CLI and synthetic video, without requesting a physical device. Screenshots are written to the ignored `output/playwright/` directory. Run it in a fresh browser profile: it writes a test recording to Slot 1.

```sh
npx --yes --package @playwright/cli playwright-cli open http://localhost:5173 --headed
npx --yes --package @playwright/cli playwright-cli run-code --filename=scripts/claw-check.js
npx --yes --package @playwright/cli playwright-cli run-code --filename=scripts/serial-compatibility-check.js
npx --yes --package @playwright/cli playwright-cli run-code --filename=scripts/browser-check.js
npx --yes --package @playwright/cli playwright-cli run-code --filename=scripts/glass-check.js
npx --yes --package @playwright/cli playwright-cli run-code --filename=scripts/viewer-check.js
npx --yes --package @playwright/cli playwright-cli run-code --filename=scripts/scene-check.js
npx --yes --package @playwright/cli playwright-cli run-code --filename=scripts/theme-check.js
npx --yes --package @playwright/cli playwright-cli run-code --filename=scripts/wrist-check.js
```

Draco decoding is served locally from `public/draco/`; it does not depend on a third-party CDN to display the arm. See `public/draco/LICENSE` for the decoder license.
