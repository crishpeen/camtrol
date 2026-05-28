# Camtrol

A browser-based webcam tracker for **movement**, **hand gestures**, and **body pose**, powered by [TensorFlow.js](https://www.tensorflow.org/js). All processing runs locally in the browser — video never leaves your device.

## Features

- **Motion detection** — frame-difference analysis (no ML model, very lightweight)
- **Hand tracking** — MediaPipe Hands via `@tensorflow-models/hand-pose-detection`
- **Hand gestures** — poses (thumbs, peace, fist, etc.), touch-style (tap, swipe, scroll, long press, rotate), pinch zoom, wave
- **Face expressions** — smile, grin, frown, surprise, grimace, squint, kiss, brow raises, and more
- **Gaze estimation** — MediaPipe iris zones by default; optional [WebGazer.js](https://webgazer.cs.brown.edu/) screen calibration (experimental, GPLv3)
- **Body pose** — MoveNet (single-person) via `@tensorflow-models/pose-detection`
- **Event log** — timestamps, details, and `console` output for every detection
- **Live overlay** — skeleton lines on the camera preview

## Run locally

GitHub Pages serves the site over HTTPS, which is required for camera access. For local development, use any static server with HTTPS or `localhost`:

```bash
npx --yes serve . -p 3000
# Open http://localhost:3000
```

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Merge to `main` — the included workflow (`.github/workflows/pages.yml`) deploys the site root automatically.

Alternatively, set **Source** to **Deploy from a branch** and choose `main` with folder `/ (root)`.

## Usage

1. Open the site (HTTPS or localhost).
2. Wait for models to load.
3. Click **Start camera** and allow webcam access.
4. Move, show gestures, or shift your body — events appear in the sidebar log.
5. Toggle detectors or adjust **Motion sensitivity** as needed.

### Hand gestures

| Gesture | How to perform |
|---------|----------------|
| Thumbs up / down | Thumb extended up or down, other fingers curled |
| Peace ✌️ | Index + middle up |
| Point 👉 | Index only |
| Middle finger | Middle only |
| Rock on 🤘 | Index + pinky up |
| Open palm ✋ | All fingers spread |
| Fist ✊ | All fingers curled |
| Pinch 🤏 | Thumb + index tips together |
| Zoom in 🔍 | Pinch, then move fingertips closer |
| Zoom out 🔎 | Pinch, then spread thumb and index apart |
| Wave 👋 | Open hand, move side to side |

### Touch-style hand gestures

| Gesture | How to perform |
|---------|----------------|
| Tap | Quick touch with index tip (small movement) |
| Double tap | Two taps within half a second |
| Long press | Hold index/pinch position still ~0.7s |
| Swipe | Fast flick left, right, up, or down |
| Scroll up/down | Point with index, drag vertically |
| Drag | Slow pan in any direction |
| Rotate | Pinch thumb+index and twist |

### Face expressions

| Expression | How to perform |
|------------|----------------|
| Smile / grin | Mouth corners up |
| Frown | Mouth corners down |
| Surprise | Open mouth + raised brows |
| Grimace | Squint + tight mouth |
| Kiss / pucker | Lips forward, narrow |
| Brows up / furrowed | Raise or lower eyebrows |

### Gaze (approximate)

**MediaPipe (default)** — uses iris landmarks from Face Mesh (`refineLandmarks: true`). A yellow **crosshair** on the video shows the estimated look point; the event log updates when your gaze moves to another **3×3 zone** on the video frame.

**WebGazer (experimental)** — choose *Gaze engine → WebGazer* in the sidebar (page reloads). Uses the [WebGazer.js](https://webgazer.cs.brown.edu/) library (GPL-3.0): it learns from your **clicks and mouse movement** while you look at the cursor, then maps gaze to the same zones on the camera preview. Face expressions are disabled in this mode to avoid loading two face models. Same camera stream as Camtrol — no second webcam.

Neither mode is calibrated lab eye-tracking — useful for demos and rough “where are you looking?” feedback.

## Project structure

```
index.html          # App shell
css/main.css        # Styles
js/app.js           # Camera loop & orchestration
js/event-log.js     # UI event log
js/overlay.js       # Canvas skeleton overlay
js/detectors/
  motion.js         # Pixel-diff motion
  hands.js          # Hand + gesture detection
  gestures.js         # Static pose classification
  gesture-motion.js   # Wave & pinch zoom (temporal)
  touch-gestures.js   # Tap, swipe, scroll, etc.
  face.js             # Face mesh detector
  face-expressions.js # Grimaces & expressions
  gaze.js             # Iris-based gaze point & zones
  gaze-webgazer.js    # WebGazer integration (optional engine)
  gaze-viewport.js    # Screen → video frame coordinate mapping
  gaze-engine.js      # Saved gaze engine preference
  gesture-stabilizer.js
  pose.js           # MoveNet body pose
```

## License

Apache-2.0 (TensorFlow.js models use their respective licenses).
