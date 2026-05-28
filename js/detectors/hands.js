/// <reference path="../../types/tf-globals.d.ts" />
import { classifyGesture, gestureLabel } from "./gestures.js";
import { createGestureStabilizer } from "./gesture-stabilizer.js";

const handPoseDetection = globalThis.handPoseDetection;
const tf = globalThis.tf;

const GESTURE_COOLDOWN_MS = 1200;
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

  function reset() {
    lastGesture.clear();
    lastPresence.clear();
    stabilizer.reset();
  }

  /**
   * @param {HTMLVideoElement} video
   */
  async function tick(video) {
    const hands = await detector.estimateHands(video, { flipHorizontal: true });
    options.onHands?.(hands);

    const now = Date.now();

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

      const raw = classifyGesture(hand.keypoints, side);
      const stable = stabilizer.push(key, raw);
      if (!stable || stable.confidence < MIN_GESTURE_CONFIDENCE) continue;

      const gestureKey = `${key}:${stable.id}`;
      if (now - (lastGesture.get(gestureKey) ?? 0) < GESTURE_COOLDOWN_MS) continue;
      lastGesture.set(gestureKey, now);

      const confPct = Math.round(stable.confidence * 100);
      options.onEvent({
        label: `Gesture: ${gestureLabel(stable.id)}`,
        detail: `${capitalize(side)} hand (${confPct}% confidence)`,
      });
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
