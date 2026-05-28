/// <reference path="../../types/tf-globals.d.ts" />
import { classifyGesture, gestureLabel, getFingerStates } from "./gestures.js";
import { createGestureStabilizer } from "./gesture-stabilizer.js";
import { createMotionGestureTracker, motionGestureLabel } from "./gesture-motion.js";

const handPoseDetection = globalThis.handPoseDetection;
const tf = globalThis.tf;

const GESTURE_COOLDOWN_MS = 1200;
const MOTION_COOLDOWN_MS = 900;
const PRESENCE_COOLDOWN_MS = 2000;
const MIN_GESTURE_CONFIDENCE = 0.55;

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
  const stabilizer = createGestureStabilizer();
  const motionTracker = createMotionGestureTracker();

  function reset() {
    lastGesture.clear();
    lastPresence.clear();
    stabilizer.reset();
    motionTracker.reset();
  }

  /**
   * @param {string} handKey
   * @param {{ id: string, confidence: number, detail?: string }} gesture
   * @param {(id: string) => string} labelFn
   * @param {number} now
   * @param {string} side
   */
  function emitGesture(handKey, gesture, labelFn, now, side) {
    const gestureKey = `${handKey}:${gesture.id}`;
    const cooldown = ["wave", "zoom_in", "zoom_out"].includes(gesture.id)
      ? MOTION_COOLDOWN_MS
      : GESTURE_COOLDOWN_MS;

    if (now - (lastGesture.get(gestureKey) ?? 0) < cooldown) return;
    lastGesture.set(gestureKey, now);

    const confPct = Math.round(gesture.confidence * 100);
    const detailParts = [`${capitalize(side)} hand`, `${confPct}% confidence`];
    if (gesture.detail) detailParts.push(gesture.detail);

    options.onEvent({
      label: `Gesture: ${labelFn(gesture.id)}`,
      detail: detailParts.join(" · "),
    });
  }

  /**
   * @param {HTMLVideoElement} video
   */
  async function tick(video) {
    const hands = await detector.estimateHands(video, { flipHorizontal: true });
    options.onHands?.(hands);

    const now = Date.now();
    const frameWidth = video.videoWidth || 640;

    for (const hand of hands) {
      const side = hand.handedness ?? "hand";
      const key = side;

      if (now - (lastPresence.get(key) ?? 0) > PRESENCE_COOLDOWN_MS) {
        lastPresence.set(key, now);
        const score = hand.score != null ? ` (${(hand.score * 100).toFixed(0)}%)` : "";
        options.onEvent({
          label: `${capitalize(side)} hand detected`,
          detail: `${hand.keypoints?.length ?? 21} keypoints${score}`,
        });
      }

      const fingerStates = getFingerStates(hand.keypoints, side);
      const openPalm =
        fingerStates.index.extended &&
        fingerStates.middle.extended &&
        fingerStates.ring.extended &&
        fingerStates.pinky.extended;

      const motion = motionTracker.push(hand.keypoints, now, frameWidth, {
        openPalm,
        handKey: key,
      });

      if (motion && motion.confidence >= MIN_GESTURE_CONFIDENCE) {
        emitGesture(key, motion, motionGestureLabel, now, side);
      }

      const raw = classifyGesture(hand.keypoints, side);
      const stable = stabilizer.push(key, raw);

      if (stable && stable.confidence >= MIN_GESTURE_CONFIDENCE) {
        // Skip static pinch when a zoom motion was just detected
        if (stable.id === "pinch" && motion && (motion.id === "zoom_in" || motion.id === "zoom_out")) {
          continue;
        }
        emitGesture(key, stable, gestureLabel, now, side);
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
