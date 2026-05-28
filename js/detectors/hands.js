/// <reference path="../../types/tf-globals.d.ts" />
import { classifyGestureWithQuality, gestureLabel, getFingerStates, isPinchPose } from "./gestures.js";
import { createPoseGestureStabilizer } from "./gesture-stabilizer.js";
import { createGestureEmitter } from "./gesture-emitter.js";
import { assessHandQuality, smoothKeypoints } from "./hand-quality.js";
import { createMotionGestureTracker, motionGestureLabel } from "./gesture-motion.js";
import { createTouchGestureTracker, touchGestureLabel } from "./touch-gestures.js";

const handPoseDetection = globalThis.handPoseDetection;
const tf = globalThis.tf;

const GESTURE_COOLDOWN_MS = 1400;
const MOTION_COOLDOWN_MS = 900;
const TOUCH_COOLDOWN_MS = 700;
const PRESENCE_COOLDOWN_MS = 2500;
const MIN_GESTURE_CONFIDENCE = 0.62;
const MIN_TOUCH_CONFIDENCE = 0.55;
const MIN_MOTION_CONFIDENCE = 0.55;
const KEYPOINT_SMOOTH_ALPHA = 0.4;

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

/**
 * @param {{ onEvent: (e: { label: string, detail?: string }) => void, onHands?: (hands: unknown[]) => void }} options
 */
export async function createHandDetector(options) {
  if (!handPoseDetection || !tf) {
    throw new Error("TensorFlow.js libraries did not load. Check your network connection.");
  }

  await tf.setBackend("webgl");
  await tf.ready();

  const model = handPoseDetection.SupportedModels.MediaPipeHands;
  const detector = await handPoseDetection.createDetector(model, {
    runtime: "tfjs",
    modelType: "full",
    maxHands: 2,
  });

  const lastGesture = new Map();
  const lastPresence = new Map();
  /** @type {Map<string, { x: number, y: number, z?: number }[]>} */
  const smoothedKp = new Map();
  const stabilizer = createPoseGestureStabilizer();
  const poseEmitter = createGestureEmitter({ minStableFrames: 7, minConfidence: 0.66 });
  const motionTracker = createMotionGestureTracker();
  const touchTracker = createTouchGestureTracker();

  function reset() {
    lastGesture.clear();
    lastPresence.clear();
    smoothedKp.clear();
    stabilizer.reset();
    poseEmitter.reset();
    motionTracker.reset();
    touchTracker.reset();
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
    const hands = await detector.estimateHands(video, { flipHorizontal: true });
    options.onHands?.(hands);

    const now = Date.now();
    const frameWidth = video.videoWidth || 640;
    const frameHeight = video.videoHeight || 480;
    const activeKeys = new Set();

    for (const hand of hands) {
      const side = hand.handedness ?? "hand";
      const key = side;
      activeKeys.add(key);

      const quality = assessHandQuality(hand.keypoints, hand.score);
      if (!quality.ok) {
        poseEmitter.unlock(key);
        smoothedKp.delete(key);
        continue;
      }

      const rawKp = hand.keypoints;
      const keypoints = smoothKeypoints(rawKp, smoothedKp.get(key) ?? null, KEYPOINT_SMOOTH_ALPHA);
      smoothedKp.set(key, keypoints);
      hand.keypoints = keypoints;

      if (now - (lastPresence.get(key) ?? 0) > PRESENCE_COOLDOWN_MS) {
        lastPresence.set(key, now);
        const score = hand.score != null ? ` (${(hand.score * 100).toFixed(0)}%)` : "";
        options.onEvent({
          label: `${capitalize(side)} hand detected`,
          detail: `${keypoints.length} keypoints${score} · tracking quality ${Math.round(quality.score * 100)}%`,
        });
      }

      const fingerStates = getFingerStates(keypoints, side);
      const pointing =
        fingerStates.index.extended &&
        !fingerStates.middle.extended &&
        fingerStates.middle.strength < 0.38;
      const pinching = isPinchPose(keypoints);
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

      const raw = classifyGestureWithQuality(keypoints, side, quality.score);
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

    return hands;
  }

  function dispose() {
    detector.dispose?.();
  }

  return { tick, reset, dispose };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
