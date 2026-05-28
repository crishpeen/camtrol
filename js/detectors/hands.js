import * as handPoseDetection from "https://cdn.jsdelivr.net/npm/@tensorflow-models/hand-pose-detection@2.0.1/+esm";
import * as tf from "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.22.0/+esm";
import "@tensorflow/tfjs-backend-webgl";

import { classifyGesture, gestureLabel } from "./gestures.js";

const GESTURE_COOLDOWN_MS = 1200;
const PRESENCE_COOLDOWN_MS = 2000;

/**
 * @param {{ onEvent: (e: { label: string, detail?: string }) => void, onHands?: (hands: unknown[]) => void }} options
 */
export async function createHandDetector(options) {
  await tf.setBackend("webgl");
  await tf.ready();

  const model = handPoseDetection.SupportedModels.MediaPipeHands;
  const detector = await handPoseDetection.createDetector(model, {
    runtime: "mediapipe",
    solutionPath: "https://cdn.jsdelivr.net/npm/@mediapipe/hands",
    modelType: "lite",
    maxHands: 2,
  });

  const lastGesture = new Map();
  const lastPresence = new Map();

  function reset() {
    lastGesture.clear();
    lastPresence.clear();
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

      const gestureId = classifyGesture(hand.keypoints);
      if (!gestureId) continue;

      const gestureKey = `${key}:${gestureId}`;
      if (now - (lastGesture.get(gestureKey) ?? 0) < GESTURE_COOLDOWN_MS) continue;
      lastGesture.set(gestureKey, now);

      options.onEvent({
        label: `Gesture: ${gestureLabel(gestureId)}`,
        detail: `${capitalize(side)} hand`,
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
