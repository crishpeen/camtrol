/**
 * Webcam gaze estimation from MediaPipe Face Mesh iris landmarks (indices 468+).
 * This is approximate — not a substitute for dedicated eye-tracking hardware.
 */

const FL = {
  NOSE_TIP: 1,
  LEFT_IRIS: 468,
  RIGHT_IRIS: 473,
  LEFT_EYE: { outer: 33, inner: 133, top: 159, bottom: 145 },
  RIGHT_EYE: { outer: 263, inner: 362, top: 386, bottom: 374 },
};

const MIN_IRIS_LANDMARKS = 474;
const SMOOTHING = 0.35;

/** @type {{ x: number, y: number } | null} */
let smoothedPoint = null;

/**
 * @param {{ x: number, y: number, z?: number }[]} kp
 * @param {number} i
 */
function pt(kp, i) {
  return kp[i];
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {{ iris: number, outer: number, inner: number, top: number, bottom: number }} eye
 */
function eyeGaze(keypoints, eye) {
  const iris = pt(keypoints, eye.iris);
  const outer = pt(keypoints, eye.outer);
  const inner = pt(keypoints, eye.inner);
  const top = pt(keypoints, eye.top);
  const bottom = pt(keypoints, eye.bottom);

  const centerX = (outer.x + inner.x) / 2;
  const centerY = (top.y + bottom.y) / 2;
  const eyeW = Math.max(Math.abs(outer.x - inner.x), 1e-6);
  const eyeH = Math.max(Math.abs(bottom.y - top.y), 1e-6);

  return {
    ratioX: (iris.x - centerX) / eyeW,
    ratioY: (iris.y - centerY) / eyeH,
    center: { x: centerX, y: centerY },
    iris: { x: iris.x, y: iris.y },
    eyeW,
    eyeH,
    corners: { outer, inner, top, bottom },
  };
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
function screenZone(x, y, w, h) {
  const col = x < w / 3 ? "left" : x < (2 * w) / 3 ? "center" : "right";
  const row = y < h / 3 ? "top" : y < (2 * h) / 3 ? "middle" : "bottom";

  const rowLabel = row === "middle" ? "center" : row === "top" ? "top" : "bottom";
  const colLabel = col === "center" ? "center" : col;

  let id;
  let label;

  if (row === "middle" && col === "center") {
    id = "center";
    label = "Center of screen";
  } else if (row === "middle") {
    id = col;
    label = col === "left" ? "Left side" : "Right side";
  } else if (col === "center") {
    id = rowLabel;
    label = row === "top" ? "Top of screen" : "Bottom of screen";
  } else {
    id = `${rowLabel}-${col}`;
    label = `${rowLabel} ${col}`.replace(/^\w/, (c) => c.toUpperCase());
  }

  return { id, label, row, col };
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {number} frameWidth
 * @param {number} frameHeight
 */
export function estimateGaze(keypoints, frameWidth, frameHeight) {
  if (!keypoints || keypoints.length < MIN_IRIS_LANDMARKS) {
    return null;
  }

  const left = eyeGaze(keypoints, { iris: FL.LEFT_IRIS, ...FL.LEFT_EYE });
  const right = eyeGaze(keypoints, { iris: FL.RIGHT_IRIS, ...FL.RIGHT_EYE });

  const faceMidX = (left.center.x + right.center.x) / 2;
  const faceW = Math.max(Math.abs(left.center.x - right.center.x), 1e-6);
  const nose = pt(keypoints, FL.NOSE_TIP);
  const headYaw = (nose.x - faceMidX) / faceW;

  const ratioX = (left.ratioX + right.ratioX) / 2 - headYaw * 0.35;
  const ratioY = (left.ratioY + right.ratioY) / 2;

  const sensitivityX = 2.4;
  const sensitivityY = 2.8;

  const rawX = frameWidth * (0.5 + ratioX * sensitivityX);
  const rawY = frameHeight * (0.47 + ratioY * sensitivityY);

  const x = Math.max(0, Math.min(frameWidth, rawX));
  const y = Math.max(0, Math.min(frameHeight, rawY));

  if (!smoothedPoint) {
    smoothedPoint = { x, y };
  } else {
    smoothedPoint = {
      x: smoothedPoint.x * (1 - SMOOTHING) + x * SMOOTHING,
      y: smoothedPoint.y * (1 - SMOOTHING) + y * SMOOTHING,
    };
  }

  const point = { x: smoothedPoint.x, y: smoothedPoint.y };
  const zone = screenZone(point.x, point.y, frameWidth, frameHeight);

  const magnitude = Math.hypot(ratioX, ratioY);
  const confidence = Math.min(1, 0.45 + magnitude * 1.8);

  return {
    point,
    zone,
    ratioX,
    ratioY,
    confidence,
    eyes: { left, right },
    hasIrisLandmarks: true,
  };
}

export function resetGazeSmoothing() {
  smoothedPoint = null;
}

export function gazeZoneLabel(zoneId) {
  const labels = {
    center: "Looking at center",
    left: "Looking left",
    right: "Looking right",
    top: "Looking up",
    bottom: "Looking down",
    "top-left": "Looking top-left",
    "top-right": "Looking top-right",
    "bottom-left": "Looking bottom-left",
    "bottom-right": "Looking bottom-right",
  };
  return labels[zoneId] ?? `Looking at ${zoneId}`;
}
