/// <reference path="../../types/tf-globals.d.ts" />
import { classifyGestureWithQuality, gestureLabel, getFingerStates, isPinchPose } from "./gestures.js";
import { createPoseGestureStabilizer } from "./gesture-stabilizer.js";
import { createGestureEmitter } from "./gesture-emitter.js";
import {
  assessHandQuality,
  keypointsForMetrics,
  passesOverlayGate,
  smoothKeypoints,
} from "./hand-quality.js";
import { createMotionGestureTracker, motionGestureLabel } from "./gesture-motion.js";
import { createTouchGestureTracker, touchGestureLabel } from "./touch-gestures.js";
import { ensureMediapipeHandsScript } from "./mediapipe-loader.js";

const handPoseDetection = globalThis.handPoseDetection;
const tf = globalThis.tf;

const GESTURE_COOLDOWN_MS = 1400;
const MOTION_COOLDOWN_MS = 900;
const TOUCH_COOLDOWN_MS = 700;
const PRESENCE_COOLDOWN_MS = 2500;
const MIN_GESTURE_CONFIDENCE = 0.58;
const MIN_TOUCH_CONFIDENCE = 0.52;
const MIN_MOTION_CONFIDENCE = 0.52;
const KEYPOINT_SMOOTH_ALPHA = 0.45;
const MEDIAPIPE_HANDS_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240";

const MOTION_IDS = new Set([
  "wave",
  "zoom_in",
  "zoom_out",
  "tap",
  "double_tap",
  "long_press",
  "swipe_left",
  "swipe_right",
  "swipe_up",
  "swipe_down",
  "scroll_up",
  "scroll_down",
  "drag_up",
  "drag_down",
  "drag_left",
  "drag_right",
  "rotate",
]);

export function isMobileDevice() {
  if (typeof matchMedia === "function" && matchMedia("(max-width: 900px)").matches) {
    return true;
  }
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent ?? "");
}

function useLiteHandModel() {
  return isMobileDevice();
}

/**
 * @param {{ onEvent: (e: { label: string, detail?: string }) => void, onHands?: (hands: unknown[]) => void, onInit?: (detail: string) => void }} options
 */
export async function createHandDetector(options) {
  if (!handPoseDetection) {
    throw new Error("hand-pose-detection script did not load.");
  }

  const logInit = (detail) => options.onInit?.(detail);

  const model = handPoseDetection.SupportedModels.MediaPipeHands;
  const modelType = useLiteHandModel() ? "lite" : "full";
  let runtime = "tfjs";
  let detector;
  /** @type {string[]} */
  const initNotes = [];

  if (isMobileDevice()) {
    logInit("Loading MediaPipe Hands (recommended on phone)…");
    const mpReady = await ensureMediapipeHandsScript();
    initNotes.push(mpReady ? "MediaPipe script loaded" : "MediaPipe script failed to load");

    if (mpReady) {
      try {
        detector = await handPoseDetection.createDetector(model, {
          runtime: "mediapipe",
          solutionPath: MEDIAPIPE_HANDS_CDN,
          modelType,
          maxHands: 2,
        });
        runtime = `mediapipe/${modelType}`;
        initNotes.push("Using MediaPipe WASM runtime");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        initNotes.push(`MediaPipe init failed: ${msg}`);
        console.warn("MediaPipe hands runtime failed:", err);
      }
    }
  }

  if (!detector) {
    if (!tf?.setBackend) {
      throw new Error("TensorFlow.js did not load — required for hand detection.");
    }

    const backends = isMobileDevice()
      ? ["wasm", "cpu", "webgl"]
      : ["webgl", "wasm", "cpu"];
    let lastErr = null;

    for (const backend of backends) {
      try {
        logInit(`Trying TensorFlow.js ${backend}…`);
        await tf.setBackend(backend);
        await tf.ready();
        detector = await handPoseDetection.createDetector(model, {
          runtime: "tfjs",
          modelType,
          maxHands: 2,
        });
        runtime = `tfjs/${backend}/${modelType}`;
        initNotes.push(`Using TF.js ${backend}`);
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        initNotes.push(`${backend} failed: ${msg}`);
        console.warn(`Hand model failed on ${backend}:`, err);
      }
    }

    if (!detector) {
      throw lastErr instanceof Error ? lastErr : new Error("Could not initialize hand detector");
    }
  }

  const lastGesture = new Map();
  const lastPresence = new Map();
  /** @type {Map<string, { x: number, y: number, z?: number }[]>} */
  const smoothedKp = new Map();
  const stabilizer = createPoseGestureStabilizer();
  const poseEmitter = createGestureEmitter({
    minStableFrames: useLiteHandModel() ? 5 : 6,
    minConfidence: 0.58,
  });
  const motionTracker = createMotionGestureTracker();
  const touchTracker = createTouchGestureTracker();
  let zeroHandFrames = 0;
  let lastDiagLog = 0;

  function reset() {
    lastGesture.clear();
    lastPresence.clear();
    smoothedKp.clear();
    stabilizer.reset();
    poseEmitter.reset();
    motionTracker.reset();
    touchTracker.reset();
    zeroHandFrames = 0;
  }

  function gestureCooldown(id) {
    if (id === "wave") return 2500;
    if (id === "zoom_in" || id === "zoom_out") return MOTION_COOLDOWN_MS;
    if (MOTION_IDS.has(id)) return TOUCH_COOLDOWN_MS;
    return GESTURE_COOLDOWN_MS;
  }

  function emitGesture(handKey, gesture, labelFn, now, side) {
    const gestureKey = `${handKey}:${gesture.id}`;
    if (now - (lastGesture.get(gestureKey) ?? 0) < gestureCooldown(gesture.id)) return;

    lastGesture.set(gestureKey, now);

    const confPct = Math.round(gesture.confidence * 100);
    const detailParts = [`${capitalize(side)} hand`, `${confPct}% confidence`];
    if (gesture.detail) detailParts.push(gesture.detail);

    options.onEvent({
      label: `Gesture: ${labelFn(gesture.id)}`,
      detail: detailParts.join(" · "),
    });
  }

  async function tick(video) {
    if (video.readyState < 2 || !video.videoWidth) {
      return [];
    }

    let hands;
    try {
      hands = await detector.estimateHands(video, { flipHorizontal: true });
    } catch (err) {
      console.error("estimateHands failed:", err);
      return [];
    }

    options.onHands?.(hands);

    const now = Date.now();
    const frameWidth = video.videoWidth;
    const frameHeight = video.videoHeight;
    const activeKeys = new Set();
    /** @type {typeof hands} */
    const overlayHands = [];

    if (!hands.length) {
      zeroHandFrames += 1;
      if (zeroHandFrames === 60 && now - lastDiagLog > 8000) {
        lastDiagLog = now;
        options.onEvent({
          label: "No hand in frame",
          detail: `${runtime} — fill frame with hand, good light`,
        });
      }
    } else {
      zeroHandFrames = 0;
    }

    for (const hand of hands) {
      if (!passesOverlayGate(hand.score)) continue;

      const side = hand.handedness ?? "hand";
      const key = side;
      activeKeys.add(key);
      overlayHands.push(hand);

      const metricsKp = keypointsForMetrics(hand.keypoints, frameWidth, frameHeight);
      const quality = assessHandQuality(metricsKp, hand.score);

      if (!quality.ok) {
        poseEmitter.unlock(key);
        smoothedKp.delete(key);
        continue;
      }

      const keypoints = smoothKeypoints(hand.keypoints, smoothedKp.get(key) ?? null, KEYPOINT_SMOOTH_ALPHA);
      smoothedKp.set(key, keypoints);
      hand.keypoints = keypoints;

      if (now - (lastPresence.get(key) ?? 0) > PRESENCE_COOLDOWN_MS) {
        lastPresence.set(key, now);
        const score = hand.score != null ? ` (${(hand.score * 100).toFixed(0)}%)` : "";
        options.onEvent({
          label: `${capitalize(side)} hand detected`,
          detail: `${keypoints.length} keypoints${score} · ${runtime}`,
        });
      }

      const fingerStates = getFingerStates(metricsKp, side);
      const pointing =
        fingerStates.index.extended &&
        !fingerStates.middle.extended &&
        fingerStates.middle.strength < 0.38;
      const pinching = isPinchPose(metricsKp);
      const openPalm =
        fingerStates.index.extended &&
        fingerStates.middle.extended &&
        fingerStates.ring.extended &&
        fingerStates.pinky.extended;

      const touch = touchTracker.push(keypoints, now, frameWidth, frameHeight, {
        handKey: key,
        pointing,
        pinching,
        openPalm,
      });

      if (touch && touch.confidence >= MIN_TOUCH_CONFIDENCE) {
        emitGesture(key, touch, touchGestureLabel, now, side);
        poseEmitter.unlock(key);
        continue;
      }

      const motion = motionTracker.push(keypoints, now, frameWidth, {
        openPalm,
        handKey: key,
      });

      if (motion && motion.confidence >= MIN_MOTION_CONFIDENCE) {
        emitGesture(key, motion, motionGestureLabel, now, side);
        poseEmitter.unlock(key);
        continue;
      }

      const raw = classifyGestureWithQuality(metricsKp, side, quality.score);
      const stable = stabilizer.push(key, raw);
      const toEmit = poseEmitter.consider(key, stable);

      if (toEmit && toEmit.confidence >= MIN_GESTURE_CONFIDENCE) {
        if (toEmit.id === "pinch" && motion && (motion.id === "zoom_in" || motion.id === "zoom_out")) {
          continue;
        }
        emitGesture(key, toEmit, gestureLabel, now, side);
      }
    }

    for (const key of smoothedKp.keys()) {
      if (!activeKeys.has(key)) {
        smoothedKp.delete(key);
        poseEmitter.unlock(key);
      }
    }

    return overlayHands;
  }

  function dispose() {
    detector.dispose?.();
  }

  return { tick, reset, dispose, modelType, runtime, initNotes };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
