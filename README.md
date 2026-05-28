# Camtrol

A browser-based webcam tracker for **movement**, **hand gestures**, and **body pose**, powered by [TensorFlow.js](https://www.tensorflow.org/js). All processing runs locally in the browser — video never leaves your device.

## Features

- **Motion detection** — frame-difference analysis (no ML model, very lightweight)
- **Hand tracking** — MediaPipe Hands via `@tensorflow-models/hand-pose-detection`
- **Gestures** — open palm, fist, peace sign, pointing, thumbs up
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
  gestures.js       # Gesture classification
  pose.js           # MoveNet body pose
```

## License

Apache-2.0 (TensorFlow.js models use their respective licenses).
