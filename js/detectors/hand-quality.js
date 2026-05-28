import { LM } from "./gestures.js";

/**
 * MediaPipe returns pixel coords on video; metrics expect 0–1 space.
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {number} frameWidth
 * @param {number} frameHeight
 */
export function keypointsForMetrics(keypoints, frameWidth, frameHeight) {
  if (!keypoints?.length) return keypoints;
  const maxCoord = Math.max(
    ...keypoints.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))
  );
  if (maxCoord <= 1.5) return keypoints;

  const w = Math.max(frameWidth, 1);
  const h = Math.max(frameHeight, 1);
  return keypoints.map((p) => ({
    ...p,
    x: p.x / w,
    y: p.y / h,
  }));
}

/**
 * Reject frames where the hand is too small, off-screen, or landmarks look unstable.
 * @param {{ x: number, y: number, z?: number }[]} keypoints — use 0–1 space (see keypointsForMetrics)
 * @param {number} [detectorScore]
 */
export function assessHandQuality(keypoints, detectorScore) {
  if (!keypoints || keypoints.length < 21) {
    return { ok: false, score: 0, reason: "incomplete" };
  }

  const wrist = keypoints[LM.WRIST];
  const indexMcp = keypoints[LM.INDEX_MCP];
  const pinkyMcp = keypoints[LM.PINKY_MCP];
  const palmWidth = Math.hypot(indexMcp.x - pinkyMcp.x, indexMcp.y - pinkyMcp.y);
  const palmHeight = Math.hypot(indexMcp.x - wrist.x, indexMcp.y - wrist.y);
  const palmSpan = Math.max(palmWidth, palmHeight, 1e-6);

  if (palmSpan < 0.045) {
    return { ok: false, score: 0.2, reason: "too_far" };
  }

  const inBounds = keypoints.every(
    (p) => p.x >= -0.12 && p.x <= 1.12 && p.y >= -0.12 && p.y <= 1.12
  );
  if (!inBounds) {
    return { ok: false, score: 0.25, reason: "partial" };
  }

  const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP, LM.THUMB_TIP];
  let spread = 0;
  for (const idx of tips) {
    spread += Math.hypot(keypoints[idx].x - wrist.x, keypoints[idx].y - wrist.y);
  }
  spread /= tips.length;
  const spreadRatio = spread / palmSpan;
  if (spreadRatio < 0.72 || spreadRatio > 3.5) {
    return { ok: false, score: 0.3, reason: "distorted" };
  }

  const det = detectorScore ?? 0.85;
  const sizeScore = Math.min(1, palmSpan / 0.12);
  const score = det * 0.5 + sizeScore * 0.35 + Math.min(1, spreadRatio / 1.6) * 0.15;

  const minDet = det >= 0.42;
  const ok = score >= 0.48 && minDet;

  return {
    ok,
    score,
    reason: ok ? "ok" : minDet ? "low_confidence" : "weak_detector",
    palmSpan,
  };
}

/** Minimum detector score to draw skeleton on video. */
export function passesOverlayGate(detectorScore) {
  return detectorScore == null || detectorScore >= 0.35;
}

/**
 * Exponential moving average on landmarks to reduce jitter.
 * @param {{ x: number, y: number, z?: number, name?: string }[]} keypoints
 * @param {{ x: number, y: number, z?: number }[] | null} previous
 * @param {number} alpha
 */
export function smoothKeypoints(keypoints, previous, alpha = 0.42) {
  if (!previous) {
    return keypoints.map((k) => ({ ...k }));
  }
  return keypoints.map((k, i) => {
    const p = previous[i] ?? k;
    return {
      ...k,
      x: p.x * (1 - alpha) + k.x * alpha,
      y: p.y * (1 - alpha) + k.y * alpha,
      z: (p.z ?? 0) * (1 - alpha) + (k.z ?? 0) * alpha,
    };
  });
}
