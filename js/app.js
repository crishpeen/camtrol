import { createEventLog } from "./event-log.js";
import { createMotionDetector } from "./detectors/motion.js";
import { createHandDetector } from "./detectors/hands.js";
import { createPoseDetector } from "./detectors/pose.js";
import { createOverlay } from "./overlay.js";

const video = /** @type {HTMLVideoElement} */ (document.getElementById("webcam"));
const overlayCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById("overlay"));
const videoPlaceholder = document.getElementById("video-placeholder");
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
const motionSensitivity = document.getElementById("motion-sensitivity");

const eventLog = createEventLog(eventLogEl, eventLogEmpty);
const overlay = createOverlay(overlayCanvas, video);

let stream = null;
let running = false;
let rafId = 0;
/** @type {ReturnType<typeof createMotionDetector> | null} */
let motionDetector = null;
/** @type {Awaited<ReturnType<typeof createHandDetector>> | null} */
let handDetector = null;
/** @type {Awaited<ReturnType<typeof createPoseDetector>> | null} */
let poseDetector = null;
let modelsReady = false;
let frameCount = 0;
const ML_EVERY_N_FRAMES = 2;
let lastHands = [];
let lastPoses = [];

motionDetector = createMotionDetector({
  onEvent: (e) => logDetection("motion", e.label, e.detail),
  getSensitivity: () => Number(motionSensitivity.value),
});

btnStart.addEventListener("click", () => startCamera());
btnStop.addEventListener("click", () => stopCamera());
btnClearLog.addEventListener("click", () => eventLog.clear());

setStatus("loading", "Loading TensorFlow.js models…");
loadModels()
  .then(() => {
    modelsReady = true;
    setStatus("ready", "Models loaded — start the camera");
    eventLog.log({
      category: "system",
      label: "Ready",
      detail: "Motion, hand gesture, and pose detectors initialized",
    });
  })
  .catch((err) => {
    console.error(err);
    setStatus("error", "Failed to load models");
    eventLog.log({
      category: "system",
      label: "Model load failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  });

async function loadModels() {
  const loaders = [];

  if (!handDetector) {
    loaders.push(
      createHandDetector({
        onEvent: (e) => logDetection("hand", e.label, e.detail),
        onHands: () => {},
      }).then((d) => {
        handDetector = d;
      })
    );
  }

  if (!poseDetector) {
    loaders.push(
      createPoseDetector({
        onEvent: (e) => logDetection("pose", e.label, e.detail),
        onPoses: () => {},
      }).then((d) => {
        poseDetector = d;
      })
    );
  }

  await Promise.all(loaders);
}

async function startCamera() {
  if (!modelsReady) {
    eventLog.log({
      category: "system",
      label: "Please wait",
      detail: "Models are still loading",
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

  motionDetector?.reset();
  handDetector?.reset();
  poseDetector?.reset();
  lastHands = [];
  lastPoses = [];
  frameCount = 0;

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

  setStatus("ready", "Camera stopped");
  eventLog.log({ category: "system", label: "Camera stopped" });
}

async function loop() {
  if (!running) return;

  frameCount += 1;
  const runMl = frameCount % ML_EVERY_N_FRAMES === 0;

  try {
    if (toggleMotion.checked) {
      motionDetector?.tick(video);
    }

    if (runMl && toggleHands.checked && handDetector) {
      lastHands = (await handDetector.tick(video)) ?? [];
    }

    if (runMl && togglePose.checked && poseDetector) {
      lastPoses = (await poseDetector.tick(video)) ?? [];
    }

    overlay.draw(
      toggleHands.checked ? lastHands : [],
      togglePose.checked ? lastPoses : []
    );
  } catch (err) {
    console.error("Detection loop error:", err);
  }

  rafId = requestAnimationFrame(loop);
}

function logDetection(category, label, detail) {
  eventLog.log({ category, label, detail });
}

/**
 * @param {"loading" | "ready" | "active" | "error"} state
 * @param {string} text
 */
function setStatus(state, text) {
  statusText.textContent = text;
  statusDot.className = "status-dot";
  if (state === "ready") statusDot.classList.add("status-dot--ready");
  if (state === "active") statusDot.classList.add("status-dot--active");
  if (state === "error") statusDot.classList.add("status-dot--error");
}
