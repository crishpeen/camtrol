import { createEventLog } from "./event-log.js";
import { createMotionDetector } from "./detectors/motion.js";
import { createOverlay } from "./overlay.js";

const video = /** @type {HTMLVideoElement} */ (document.getElementById("webcam"));
const overlayCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById("overlay"));
const videoWrap = video.closest(".video-wrap");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnClearLog = document.getElementById("btn-clear-log");
const eventLogEl = document.getElementById("event-log");
const eventLogEmpty = document.getElementById("event-log-empty");
const toggleMotion = document.getElementById("toggle-motion");
const toggleHands = document.getElementById("toggle-hands");
const togglePose = document.getElementById("toggle-pose");
const toggleFace = document.getElementById("toggle-face");
const toggleGazeOverlay = document.getElementById("toggle-gaze-overlay");
const motionSensitivity = document.getElementById("motion-sensitivity");

const eventLog = createEventLog(eventLogEl, eventLogEmpty);
const overlay = createOverlay(overlayCanvas, video);

let stream = null;
let running = false;
let rafId = 0;
/** Pause pixel motion while hands/face/pose are visible (avoids flooding the log). */
let mlSubjectsActiveUntil = 0;
const motionDetector = createMotionDetector({
  onEvent: (e) => logDetection("motion", e.label, e.detail),
  getSensitivity: () => Number(motionSensitivity.value),
  isSuppressed: () => Date.now() < mlSubjectsActiveUntil,
});
let handDetector = null;
let poseDetector = null;
let faceDetector = null;
let frameCount = 0;
let mlBusy = false;
let lastHands = [];
let lastPoses = [];
let lastFaces = [];

setStatus("ready", "Ready — start the camera (ML models loading…)");
eventLog.log({
  category: "system",
  label: "App started",
  detail: "Hands, face & pose load in the background — motion is off by default",
});

btnStart.addEventListener("click", () => startCamera());
btnStop.addEventListener("click", () => stopCamera());
btnClearLog.addEventListener("click", () => eventLog.clear());

const eventStrip = document.getElementById("event-strip");
const btnToggleLog = document.getElementById("btn-toggle-log");

btnToggleLog?.addEventListener("click", () => {
  const collapsed = eventStrip?.classList.toggle("event-strip--collapsed");
  const expanded = !collapsed;
  btnToggleLog.setAttribute("aria-expanded", String(expanded));
  btnToggleLog.title = expanded ? "Collapse event list" : "Expand event list";
  btnToggleLog.textContent = expanded ? "▼" : "▶";
});

loadModels();

async function loadModels() {
  if (!globalThis.tf?.setBackend) {
    eventLog.log({
      category: "system",
      label: "TensorFlow.js missing",
      detail: "Script bundles failed to load — motion detection still works",
    });
    if (toggleHands) toggleHands.disabled = true;
    if (togglePose) togglePose.disabled = true;
    if (toggleFace) toggleFace.disabled = true;
    return;
  }

  const handPromise = (async () => {
    try {
      const { createHandDetector } = await import("./detectors/hands.js");
      handDetector = await createHandDetector({
        onEvent: (e) => logDetection("hand", e.label, e.detail),
      });
      eventLog.log({
        category: "system",
        label: "Hand detector ready",
        detail: "Poses + touch gestures enabled",
      });
    } catch (err) {
      console.error(err);
      eventLog.log({
        category: "system",
        label: "Hand detector failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      if (toggleHands) toggleHands.disabled = true;
    }
  })();

  const posePromise = (async () => {
    try {
      const { createPoseDetector } = await import("./detectors/pose.js");
      poseDetector = await createPoseDetector({
        onEvent: (e) => logDetection("pose", e.label, e.detail),
      });
      eventLog.log({
        category: "system",
        label: "Pose detector ready",
        detail: "Body tracking enabled",
      });
    } catch (err) {
      console.error(err);
      eventLog.log({
        category: "system",
        label: "Pose detector failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      if (togglePose) togglePose.disabled = true;
    }
  })();

  const facePromise = (async () => {
    if (!globalThis.faceLandmarksDetection) {
      eventLog.log({
        category: "system",
        label: "Face model unavailable",
        detail: "face-landmarks-detection script missing from page",
      });
      if (toggleFace) toggleFace.disabled = true;
      return;
    }
    try {
      const { createFaceDetector } = await import("./detectors/face.js");
      faceDetector = await createFaceDetector({
        onEvent: (e) => logDetection("face", e.label, e.detail),
      });
      eventLog.log({
        category: "system",
        label: "Face detector ready",
        detail: "Expressions, grimaces & iris gaze enabled",
      });
    } catch (err) {
      console.error(err);
      eventLog.log({
        category: "system",
        label: "Face detector failed",
        detail: err instanceof Error ? err.message : String(err),
      });
      if (toggleFace) toggleFace.disabled = true;
    }
  })();

  await Promise.allSettled([handPromise, posePromise, facePromise]);
  setStatus(running ? "active" : "ready", running ? "Tracking active" : "Models loaded");
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("error", "Camera not supported in this browser");
    eventLog.log({
      category: "system",
      label: "Camera unavailable",
      detail: "getUserMedia is not supported (use HTTPS or localhost)",
    });
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    setStatus("error", "Camera permission denied");
    eventLog.log({
      category: "system",
      label: "Camera error",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  video.srcObject = stream;
  await video.play();

  videoWrap?.classList.add("video-wrap--active");
  btnStart.disabled = true;
  btnStop.disabled = false;

  motionDetector.reset();
  handDetector?.reset();
  poseDetector?.reset();
  faceDetector?.reset();
  lastHands = [];
  lastPoses = [];
  lastFaces = [];
  frameCount = 0;
  mlSubjectsActiveUntil = 0;

  running = true;
  setStatus("active", "Tracking active");
  eventLog.log({
    category: "system",
    label: "Camera started",
    detail: `${video.videoWidth}×${video.videoHeight}`,
  });

  loop();
}

function stopCamera() {
  running = false;
  cancelAnimationFrame(rafId);

  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }

  video.srcObject = null;
  videoWrap?.classList.remove("video-wrap--active");
  btnStart.disabled = false;
  btnStop.disabled = true;
  overlay.clear();
  lastHands = [];
  lastPoses = [];
  lastFaces = [];

  setStatus("ready", "Camera stopped");
  eventLog.log({ category: "system", label: "Camera stopped" });
}

async function loop() {
  if (!running) return;

  frameCount += 1;

  try {
    if (!mlBusy) {
      mlBusy = true;
      const mlTasks = [];

      if (toggleHands.checked && handDetector) {
        mlTasks.push(
          handDetector.tick(video).then((hands) => {
            lastHands = hands ?? [];
          })
        );
      }

      if (togglePose.checked && poseDetector) {
        mlTasks.push(
          poseDetector.tick(video).then((poses) => {
            lastPoses = poses ?? [];
          })
        );
      }

      if (toggleFace.checked && faceDetector) {
        mlTasks.push(
          faceDetector.tick(video).then((faces) => {
            lastFaces = faces ?? [];
          })
        );
      }

      if (mlTasks.length) {
        await Promise.all(mlTasks);
        markMlSubjectsActive();
      }

      mlBusy = false;
    }

    if (toggleMotion.checked) {
      motionDetector.tick(video);
    }

    const facesForOverlay =
      toggleFace.checked && lastFaces.length
        ? lastFaces.map((f) => ({
            ...f,
            gaze: toggleGazeOverlay?.checked !== false ? f.gaze : null,
          }))
        : [];

    overlay.draw(toggleHands.checked ? lastHands : [], togglePose.checked ? lastPoses : [], facesForOverlay);
  } catch (err) {
    mlBusy = false;
    console.error("Detection loop error:", err);
  }

  rafId = requestAnimationFrame(loop);
}

/** @param {number} [holdMs] */
function markMlSubjectsActive(holdMs = 900) {
  if (lastHands.length || lastFaces.length || lastPoses.length) {
    mlSubjectsActiveUntil = Math.max(mlSubjectsActiveUntil, Date.now() + holdMs);
  }
}

function logDetection(category, label, detail) {
  eventLog.log({ category, label, detail });
}

function setStatus(state, text) {
  statusText.textContent = text;
  statusDot.className = "status-dot";
  if (state === "ready") statusDot.classList.add("status-dot--ready");
  if (state === "active") statusDot.classList.add("status-dot--active");
  if (state === "error") statusDot.classList.add("status-dot--error");
}
