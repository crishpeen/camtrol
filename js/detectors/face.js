/// <reference path="../../types/tf-globals.d.ts" />
import { classifyFaceExpression, faceExpressionLabel } from "./face-expressions.js";
import { createGestureStabilizer } from "./gesture-stabilizer.js";
import { estimateGaze, resetGazeSmoothing, gazeZoneLabel } from "./gaze.js";

const faceLandmarksDetection = globalThis.faceLandmarksDetection;
const tf = globalThis.tf;

const PRESENCE_COOLDOWN_MS = 3000;
const EXPRESSION_COOLDOWN_MS = 1400;
const GAZE_ZONE_COOLDOWN_MS = 1100;
const MIN_CONFIDENCE = 0.48;
const MIN_GAZE_CONFIDENCE = 0.45;

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
  let lastGazeZone = null;
  let lastGazeEmit = 0;

  function reset() {
    stabilizer.reset();
    lastExpression.clear();
    lastPresence = 0;
    lastGazeZone = null;
    resetGazeSmoothing();
  }

  async function tick(video) {
    const faces = await detector.estimateFaces(video, { flipHorizontal: true });
    options.onFaces?.(faces);

    const now = Date.now();
    const frameWidth = video.videoWidth || 640;
    const frameHeight = video.videoHeight || 480;

    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      const key = `face${i}`;

      if (now - lastPresence > PRESENCE_COOLDOWN_MS) {
        lastPresence = now;
        const pts = face.keypoints?.length ?? face.scaledMesh?.length ?? 0;
        options.onEvent({
          label: "Face detected",
          detail: `${pts} landmarks${pts >= 474 ? " (iris / gaze enabled)" : ""}`,
        });
      }

      const keypoints = face.keypoints ?? face.scaledMesh;
      if (!keypoints?.length) continue;

      const gaze = estimateGaze(keypoints, frameWidth, frameHeight);
      if (gaze) {
        face.gaze = gaze;
        if (
          gaze.confidence >= MIN_GAZE_CONFIDENCE &&
          gaze.zone.id !== lastGazeZone &&
          now - lastGazeEmit > GAZE_ZONE_COOLDOWN_MS
        ) {
          lastGazeZone = gaze.zone.id;
          lastGazeEmit = now;
          options.onEvent({
            label: gazeZoneLabel(gaze.zone.id),
            detail: `${gaze.zone.label} · (${Math.round(gaze.point.x)}, ${Math.round(gaze.point.y)})`,
          });
        }
      } else {
        face.gaze = null;
      }

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
