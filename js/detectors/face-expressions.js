/**
 * Face grimaces / expressions from MediaPipe Face Mesh landmarks.
 * Landmark indices: https://github.com/google/mediapipe/wiki/MediaPipe-Face-Mesh
 */

const FL = {
  NOSE_TIP: 1,
  CHIN: 152,
  UPPER_LIP: 13,
  LOWER_LIP: 14,
  MOUTH_LEFT: 61,
  MOUTH_RIGHT: 291,
  LEFT_EYE_TOP: 159,
  LEFT_EYE_BOTTOM: 145,
  LEFT_EYE_OUTER: 33,
  LEFT_EYE_INNER: 133,
  RIGHT_EYE_TOP: 386,
  RIGHT_EYE_BOTTOM: 374,
  RIGHT_EYE_OUTER: 263,
  RIGHT_EYE_INNER: 362,
  LEFT_BROW: 105,
  RIGHT_BROW: 334,
  LEFT_CHEEK: 234,
  RIGHT_CHEEK: 454,
};

/**
 * @param {{ x: number, y: number, z?: number }[]} kp
 * @param {number} i
 */
function pt(kp, i) {
  return kp[i] ?? kp[0];
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

/**
 * @param {{ x: number, y: number, z?: number }[]} kp
 */
function faceScale(kp) {
  return Math.max(dist(pt(kp, FL.NOSE_TIP), pt(kp, FL.CHIN)), 1e-6);
}

/**
 * @param {{ x: number, y: number, z?: number }[]} kp
 */
function eyeAspectRatio(kp, top, bottom, outer, inner) {
  const v = dist(pt(kp, top), pt(kp, bottom));
  const h = dist(pt(kp, outer), pt(kp, inner));
  return v / Math.max(h, 1e-6);
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @returns {{ id: string, confidence: number, detail?: string } | null}
 */
export function classifyFaceExpression(keypoints) {
  if (!keypoints || keypoints.length < 300) return null;

  const scale = faceScale(keypoints);
  const mouthW = dist(pt(keypoints, FL.MOUTH_LEFT), pt(keypoints, FL.MOUTH_RIGHT)) / scale;
  const mouthOpen = dist(pt(keypoints, FL.UPPER_LIP), pt(keypoints, FL.LOWER_LIP)) / scale;
  const cornerY = (pt(keypoints, FL.MOUTH_LEFT).y + pt(keypoints, FL.MOUTH_RIGHT).y) / 2;
  const lipY = pt(keypoints, FL.UPPER_LIP).y;
  const smileCurve = (lipY - cornerY) / scale;
  const frownCurve = (cornerY - lipY) / scale;

  const leftEar = eyeAspectRatio(
    keypoints,
    FL.LEFT_EYE_TOP,
    FL.LEFT_EYE_BOTTOM,
    FL.LEFT_EYE_OUTER,
    FL.LEFT_EYE_INNER
  );
  const rightEar = eyeAspectRatio(
    keypoints,
    FL.RIGHT_EYE_TOP,
    FL.RIGHT_EYE_BOTTOM,
    FL.RIGHT_EYE_OUTER,
    FL.RIGHT_EYE_INNER
  );
  const avgEar = (leftEar + rightEar) / 2;

  const leftBrowRaise = (pt(keypoints, FL.LEFT_EYE_TOP).y - pt(keypoints, FL.LEFT_BROW).y) / scale;
  const rightBrowRaise = (pt(keypoints, FL.RIGHT_EYE_TOP).y - pt(keypoints, FL.RIGHT_BROW).y) / scale;
  const browsUp = leftBrowRaise > 0.045 && rightBrowRaise > 0.045;

  const lipProtrusion =
    ((pt(keypoints, FL.UPPER_LIP).z ?? 0) + (pt(keypoints, FL.LOWER_LIP).z ?? 0)) / 2 -
    ((pt(keypoints, FL.NOSE_TIP).z ?? 0) + (pt(keypoints, FL.CHIN).z ?? 0)) / 2;

  /** @type {{ id: string, confidence: number, detail?: string }[]} */
  const candidates = [];

  if (mouthOpen > 0.14 && browsUp) {
    candidates.push({ id: "surprise", confidence: 0.7 + mouthOpen * 2, detail: "Mouth open + brows up" });
  }

  if (mouthOpen > 0.16 && !browsUp) {
    candidates.push({ id: "jaw_drop", confidence: 0.65 + mouthOpen * 2, detail: "Mouth wide open" });
  }

  if (avgEar < 0.17 && mouthW < 0.38 && smileCurve < 0.02) {
    candidates.push({
      id: "grimace",
      confidence: 0.8 + (0.17 - avgEar) * 2,
      detail: "Squinting + tight mouth",
    });
  }

  if (avgEar < 0.19 && smileCurve > 0.02) {
    candidates.push({ id: "squint", confidence: 0.72, detail: "Eyes narrowed" });
  }

  if (smileCurve > 0.045 && mouthOpen < 0.12) {
    candidates.push({ id: "smile", confidence: 0.75 + smileCurve * 3, detail: "Mouth corners up" });
  }

  if (smileCurve > 0.035 && mouthOpen > 0.08) {
    candidates.push({ id: "grin", confidence: 0.78 + smileCurve * 2, detail: "Big smile" });
  }

  if (frownCurve > 0.04 && smileCurve < 0.02) {
    candidates.push({ id: "frown", confidence: 0.75 + frownCurve * 3, detail: "Mouth corners down" });
  }

  if (mouthW < 0.3 && mouthOpen > 0.05 && Math.abs(lipProtrusion) > 0.01) {
    candidates.push({ id: "kiss", confidence: 0.7, detail: "Lips puckered" });
  }

  if (browsUp && mouthOpen < 0.1 && smileCurve < 0.03) {
    candidates.push({ id: "brows_up", confidence: 0.68, detail: "Eyebrows raised" });
  }

  if (leftBrowRaise < 0.02 && rightBrowRaise < 0.02 && avgEar > 0.2) {
    const browMid = (pt(keypoints, FL.LEFT_BROW).y + pt(keypoints, FL.RIGHT_BROW).y) / 2;
    const eyeMid = (pt(keypoints, FL.LEFT_EYE_TOP).y + pt(keypoints, FL.RIGHT_EYE_TOP).y) / 2;
    if (browMid > eyeMid + scale * 0.02) {
      candidates.push({ id: "brows_down", confidence: 0.7, detail: "Eyebrows furrowed" });
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  return {
    id: best.id,
    confidence: Math.min(1, best.confidence),
    detail: best.detail,
  };
}

export const FACE_EXPRESSION_LABELS = {
  smile: "Smile 😊",
  grin: "Grin 😁",
  frown: "Frown 😞",
  surprise: "Surprise 😮",
  jaw_drop: "Mouth open 😲",
  grimace: "Grimace 😬",
  squint: "Squint 😑",
  kiss: "Kiss / pucker 😗",
  brows_up: "Brows up 🤨",
  brows_down: "Brows furrowed 😠",
};

export function faceExpressionLabel(id) {
  return FACE_EXPRESSION_LABELS[id] ?? id;
}
