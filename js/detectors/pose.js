import * as poseDetection from "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/+esm";
import * as tf from "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.22.0/+esm";
import "@tensorflow/tfjs-backend-webgl";

const COOLDOWN_MS = 1500;
const MOVE_THRESHOLD = 0.08;

const KEYPOINT_NAMES = {
  nose: "Head",
  left_shoulder: "Left shoulder",
  right_shoulder: "Right shoulder",
  left_elbow: "Left elbow",
  right_elbow: "Right elbow",
  left_wrist: "Left wrist",
  right_wrist: "Right wrist",
  left_hip: "Left hip",
  right_hip: "Right hip",
  left_knee: "Left knee",
  right_knee: "Right knee",
};

/**
 * @param {{ onEvent: (e: { label: string, detail?: string }) => void, onPoses?: (poses: unknown[]) => void }} options
 */
export async function createPoseDetector(options) {
  await tf.setBackend("webgl");
  await tf.ready();

  const model = poseDetection.SupportedModels.MoveNet;
  const detector = await poseDetection.createDetector(model, {
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    enableSmoothing: true,
  });

  let lastKeypoints = null;
  let lastBodySeen = 0;
  let lastEmit = new Map();

  function reset() {
    lastKeypoints = null;
    lastEmit.clear();
  }

  /**
   * @param {HTMLVideoElement} video
   */
  async function tick(video) {
    const poses = await detector.estimatePoses(video, { flipHorizontal: true });
    options.onPoses?.(poses);

    const now = Date.now();
    const pose = poses[0];

    if (!pose?.keypoints?.length) {
      lastKeypoints = null;
      return poses;
    }

    if (now - lastBodySeen > COOLDOWN_MS) {
      lastBodySeen = now;
      const confident = pose.keypoints.filter((k) => (k.score ?? 0) > 0.35).length;
      options.onEvent({
        label: "Body detected",
        detail: `${confident} confident keypoints`,
      });
    }

    if (lastKeypoints) {
      for (const kp of pose.keypoints) {
        if ((kp.score ?? 0) < 0.4 || !KEYPOINT_NAMES[kp.name]) continue;

        const prev = lastKeypoints.find((p) => p.name === kp.name);
        if (!prev) continue;

        const dx = kp.x - prev.x;
        const dy = kp.y - prev.y;
        const dist = Math.hypot(dx, dy) / Math.max(video.videoWidth, video.videoHeight, 1);

        if (dist < MOVE_THRESHOLD) continue;

        const emitKey = kp.name;
        if (now - (lastEmit.get(emitKey) ?? 0) < COOLDOWN_MS) continue;
        lastEmit.set(emitKey, now);

        const label = KEYPOINT_NAMES[kp.name] ?? kp.name;
        options.onEvent({
          label: `${label} moved`,
          detail: `Displacement ~${(dist * 100).toFixed(1)}% of frame`,
        });
      }
    }

    lastKeypoints = pose.keypoints.map((k) => ({ ...k }));
    return poses;
  }

  function dispose() {
    detector.dispose?.();
  }

  return { tick, reset, dispose };
}
