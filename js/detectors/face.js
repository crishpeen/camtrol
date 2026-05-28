/// <reference path="../../types/tf-globals.d.ts" />
import { classifyFaceExpression, faceExpressionLabel } from "./face-expressions.js";
import { createGestureStabilizer } from "./gesture-stabilizer.js";

const faceLandmarksDetection = globalThis.faceLandmarksDetection;
const tf = globalThis.tf;

const PRESENCE_COOLDOWN_MS = 3000;
const EXPRESSION_COOLDOWN_MS = 1400;
const MIN_CONFIDENCE = 0.52;

/**
 * @param {{ onEvent: (e: { label: string, detail?: string }) => void, onFaces?: (faces: unknown[]) => void }} options
 */
export async function createFaceDetector(options) {
  if (!faceLandmarksDetection || !tf) {
    throw new Error("Face landmarks library did not load.");
  }

  await tf.setBackend("webgl");
  await tf.ready();

  const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
  const detector = await faceLandmarksDetection.createDetector(model, {
    runtime: "tfjs",
    maxFaces: 1,
    refineLandmarks: true,
  });

  const stabilizer = createGestureStabilizer();
  let lastPresence = 0;
  const lastExpression = new Map();

  function reset() {
    stabilizer.reset();
    lastExpression.clear();
    lastPresence = 0;
  }

  /**
   * @param {HTMLVideoElement} video
   */
  async function tick(video) {
    const faces = await detector.estimateFaces(video, { flipHorizontal: true });
    options.onFaces?.(faces);

    const now = Date.now();

    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      const key = `face${i}`;

      if (now - lastPresence > PRESENCE_COOLDOWN_MS) {
        lastPresence = now;
        const pts = face.keypoints?.length ?? face.scaledMesh?.length ?? 0;
        options.onEvent({
          label: "Face detected",
          detail: `${pts} landmarks`,
        });
      }

      const keypoints = face.keypoints ?? face.scaledMesh;
      if (!keypoints?.length) continue;

      const raw = classifyFaceExpression(keypoints);
      const stable = stabilizer.push(key, raw);

      if (!stable || stable.confidence < MIN_CONFIDENCE) continue;

      const exprKey = `${key}:${stable.id}`;
      if (now - (lastExpression.get(exprKey) ?? 0) < EXPRESSION_COOLDOWN_MS) continue;
      lastExpression.set(exprKey, now);

      const confPct = Math.round(stable.confidence * 100);
      options.onEvent({
        label: `Face: ${faceExpressionLabel(stable.id)}`,
        detail: [stable.detail, `${confPct}% confidence`].filter(Boolean).join(" · "),
      });
    }

    return faces;
  }

  function dispose() {
    detector.dispose?.();
  }

  return { tick, reset, dispose };
}
