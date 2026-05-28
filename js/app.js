import { createEventLog } from "./event-log.js";
import { createMotionDetector } from "./detectors/motion.js";
import { createOverlay } from "./overlay.js";
import {
  applyMirrorToDom,
  defaultMirrorForFacing,
  fillCameraSelect,
  openCameraStream,
  refreshCameraList,
  streamFacingMode,
} from "./camera.js";
import { isMirrorPreview, setMirrorPreview } from "./mirror-state.js";
import { getGesturePreferences } from "./gesture-preferences.js";

const gesturePrefs = getGesturePreferences();

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
const cameraSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("camera-select"));
const toggleMirror = /** @type {HTMLInputElement | null} */ (document.getElementById("toggle-mirror"));

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
let lastHands = [];
let handRuntimeLabel = "";
let lastPoses = [];
let lastFaces = [];
/** @type {MediaDeviceInfo[]} */
let cameras = [];
let selectedCameraId = "";
let currentFacing = null;

setStatus("ready", "Ready — start the camera (ML models loading…)");
eventLog.log({
  category: "system",
  label: "App started",
  detail: "Hands, face & pose load in the background — motion is off by default",
});

btnStart.addEventListener("click", () => startCamera());
btnStop.addEventListener("click", () => stopCamera());
btnClearLog.addEventListener("click", () => eventLog.clear());

toggleMirror?.addEventListener("change", () => {
  setMirrorPreview(toggleMirror.checked);
  applyMirrorToDom(videoWrap, isMirrorPreview());
  resetTrackingState();
});

cameraSelect?.addEventListener("change", () => {
  selectedCameraId = cameraSelect.value;
  if (running && selectedCameraId) {
    switchCamera(selectedCameraId);
  }
});

const eventStrip = document.getElementById("event-strip");
const btnToggleLog = document.getElementById("btn-toggle-log");

btnToggleLog?.addEventListener("click", () => {
  const collapsed = eventStrip?.classList.toggle("event-strip--collapsed");
  const expanded = !collapsed;
  btnToggleLog.setAttribute("aria-expanded", String(expanded));
  btnToggleLog.title = expanded ? "Collapse event list" : "Expand event list";
  btnToggleLog.textContent = expanded ? "▼" : "▶";
});

applyMobileDefaults();
initGesturePreferencesUI();
loadModels();

function initGesturePreferencesUI() {
  const root = document.getElementById("gesture-toggles-root");
  gesturePrefs.mountUI(root);

  document.getElementById("btn-gestures-all")?.addEventListener("click", () => gesturePrefs.setAll(true));
  document.getElementById("btn-gestures-none")?.addEventListener("click", () => gesturePrefs.setAll(false));
  document.getElementById("btn-gestures-reset")?.addEventListener("click", () => gesturePrefs.resetDefaults());
}

function applyMobileDefaults() {
  const mobile =
    typeof matchMedia === "function" && matchMedia("(max-width: 900px)").matches;
  if (!mobile) return;
  if (togglePose) togglePose.checked = false;
  if (toggleFace) toggleFace.checked = false;
  eventLog.log({
    category: "system",
    label: "Mobile mode",
    detail: "Pose & face off by default so hand tracking gets GPU priority",
  });
}

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

  const { createHandDetector, isMobileDevice } = await import("./detectors/hands.js");
  const mobile = isMobileDevice();

  try {
    handDetector = await createHandDetector({
      onEvent: (e) => logDetection("hand", e.label, e.detail),
      onInit: (detail) =>
        eventLog.log({ category: "system", label: "Hands loading", detail }),
      isGestureEnabled: (id) => gesturePrefs.isEnabled(id),
    });
    handRuntimeLabel = handDetector?.runtime ?? "unknown";
    if (handDetector?.initNotes?.length) {
      for (const note of handDetector.initNotes) {
        eventLog.log({ category: "system", label: "Hands init", detail: note });
      }
    }
    eventLog.log({
      category: "system",
      label: "Hand detector ready",
      detail: `${handRuntimeLabel} — hold gestures ~0.5s`,
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

  if (!mobile) {
    await Promise.allSettled([loadPoseModel(), loadFaceModel()]);
  } else {
    togglePose?.addEventListener("change", () => {
      if (togglePose.checked) loadPoseModel();
    });
    toggleFace?.addEventListener("change", () => {
      if (toggleFace.checked) loadFaceModel();
    });
  }

  setStatus(running ? "active" : "ready", running ? "Tracking active" : "Models loaded");
}

let poseLoading = false;
let faceLoading = false;

async function loadPoseModel() {
  if (poseDetector || poseLoading) return;
  poseLoading = true;
  try {
    const { createPoseDetector } = await import("./detectors/pose.js");
      poseDetector = await createPoseDetector({
        onEvent: (e) => logDetection("pose", e.label, e.detail),
        isGestureEnabled: (id) => gesturePrefs.isEnabled(id),
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
    if (togglePose) togglePose.checked = false;
  } finally {
    poseLoading = false;
  }
}

async function loadFaceModel() {
  if (faceDetector || faceLoading) return;
  faceLoading = true;
  if (!globalThis.faceLandmarksDetection) {
    eventLog.log({
      category: "system",
      label: "Face model unavailable",
      detail: "face-landmarks-detection script missing from page",
    });
    if (toggleFace) toggleFace.checked = false;
    faceLoading = false;
    return;
  }
  try {
    const { createFaceDetector } = await import("./detectors/face.js");
      faceDetector = await createFaceDetector({
        onEvent: (e) => logDetection("face", e.label, e.detail),
        isGestureEnabled: (id) => gesturePrefs.isEnabled(id),
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
    if (toggleFace) toggleFace.checked = false;
  } finally {
    faceLoading = false;
  }
}

function resetTrackingState() {
  motionDetector.reset();
  handDetector?.reset();
  poseDetector?.reset();
  faceDetector?.reset();
  lastHands = [];
  lastPoses = [];
  lastFaces = [];
  overlay.clear();
}

function applyMirrorForStream(mediaStream) {
  currentFacing = streamFacingMode(mediaStream);
  const mirrorOn = defaultMirrorForFacing(currentFacing);
  setMirrorPreview(mirrorOn);
  if (toggleMirror) toggleMirror.checked = mirrorOn;
  applyMirrorToDom(videoWrap, isMirrorPreview());
}

async function updateCameraList() {
  try {
    const list = await refreshCameraList(selectedCameraId);
    cameras = list.cameras;
    fillCameraSelect(cameraSelect, cameras, selectedCameraId || cameras[0]?.deviceId);
    if (!selectedCameraId && cameras[0]) selectedCameraId = cameras[0].deviceId;
  } catch (err) {
    console.warn("enumerateDevices failed:", err);
  }
}

/**
 * @param {{ deviceId?: string, facingMode?: string }} choice
 */
async function startCameraWithChoice(choice) {
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }

  stream = await openCameraStream(choice);
  if (choice.deviceId) selectedCameraId = choice.deviceId;

  video.srcObject = stream;
  await video.play();

  applyMirrorForStream(stream);
  await updateCameraList();

  videoWrap?.classList.add("video-wrap--active");
  btnStart.disabled = true;
  btnStop.disabled = false;
  if (cameraSelect) cameraSelect.disabled = cameras.length < 2;

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

  const track = stream.getVideoTracks()[0];
  const label = track?.label ?? "camera";
  eventLog.log({
    category: "system",
    label: "Camera started",
    detail: `${label} · ${video.videoWidth}×${video.videoHeight} · mirror ${isMirrorPreview() ? "on" : "off"}`,
  });

  if (!rafId) loop();
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

  const choice = selectedCameraId
    ? { deviceId: selectedCameraId }
    : { facingMode: "user" };

  try {
    await startCameraWithChoice(choice);
  } catch (err) {
    setStatus("error", "Camera permission denied");
    eventLog.log({
      category: "system",
      label: "Camera error",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function switchCamera(deviceId) {
  if (!deviceId || !running) return;
  try {
    await startCameraWithChoice({ deviceId });
    eventLog.log({
      category: "system",
      label: "Camera switched",
      detail: cameras.find((c) => c.deviceId === deviceId)?.label ?? deviceId,
    });
  } catch (err) {
    eventLog.log({
      category: "system",
      label: "Camera switch failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
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
  applyMirrorToDom(videoWrap, false);
  setMirrorPreview(false);
  if (toggleMirror) toggleMirror.checked = false;
  btnStart.disabled = false;
  btnStop.disabled = true;
  if (cameraSelect) cameraSelect.disabled = cameras.length < 2;
  overlay.clear();
  lastHands = [];
  lastPoses = [];
  lastFaces = [];

  setStatus("ready", "Camera stopped");
  eventLog.log({ category: "system", label: "Camera stopped" });
}

async function loop() {
  if (!running) return;

  try {
    if (toggleHands.checked && handDetector) {
      lastHands = (await handDetector.tick(video)) ?? [];
    }

    frameCount += 1;
    const runBodyFace = frameCount % 2 === 0;

    if (runBodyFace && togglePose.checked && poseDetector) {
      lastPoses = (await poseDetector.tick(video)) ?? [];
    }
    if (runBodyFace && toggleFace.checked && faceDetector) {
      lastFaces = (await faceDetector.tick(video)) ?? [];
    }

    if (toggleMotion.checked) {
      motionDetector.tick(video);
    }

    if (lastHands.length || lastFaces.length || lastPoses.length) {
      markMlSubjectsActive();
    }

    const facesForOverlay =
      toggleFace.checked && lastFaces.length
        ? lastFaces.map((f) => ({
            ...f,
            gaze: toggleGazeOverlay?.checked !== false ? f.gaze : null,
          }))
        : [];

    overlay.draw(toggleHands.checked ? lastHands : [], togglePose.checked ? lastPoses : [], facesForOverlay);

    if (running && toggleHands.checked && handDetector) {
      const n = lastHands.length;
      const base = "Tracking active";
      setStatus("active", n ? `${base} · ${n} hand${n > 1 ? "s" : ""}` : `${base} · scanning for hands…`);
    }
  } catch (err) {
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
