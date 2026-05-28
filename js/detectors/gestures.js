/** MediaPipe hand landmark indices */
const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
};

/**
 * @param {{ x: number, y: number }[]} keypoints
 */
function isFingerExtended(keypoints, tipIdx, pipIdx) {
  const wrist = keypoints[LM.WRIST];
  const tip = keypoints[tipIdx];
  const pip = keypoints[pipIdx];
  const tipDist = dist(tip, wrist);
  const pipDist = dist(pip, wrist);
  return tipDist > pipDist * 1.15;
}

/**
 * Thumb uses horizontal spread vs palm center.
 * @param {{ x: number, y: number }[]} keypoints
 */
function isThumbExtended(keypoints) {
  const wrist = keypoints[LM.WRIST];
  const tip = keypoints[LM.THUMB_TIP];
  const ip = keypoints[LM.THUMB_IP];
  return dist(tip, wrist) > dist(ip, wrist) * 1.05;
}

/**
 * @param {{ x: number, y: number }[]} keypoints
 * @returns {string | null}
 */
export function classifyGesture(keypoints) {
  if (!keypoints || keypoints.length < 21) return null;

  const index = isFingerExtended(keypoints, LM.INDEX_TIP, LM.INDEX_PIP);
  const middle = isFingerExtended(keypoints, LM.MIDDLE_TIP, LM.MIDDLE_PIP);
  const ring = isFingerExtended(keypoints, LM.RING_TIP, LM.RING_PIP);
  const pinky = isFingerExtended(keypoints, LM.PINKY_TIP, LM.PINKY_PIP);
  const thumb = isThumbExtended(keypoints);

  const extendedCount = [index, middle, ring, pinky, thumb].filter(Boolean).length;

  if (extendedCount >= 4 && index && middle && ring && pinky) {
    return "open_palm";
  }
  if (extendedCount <= 1 && !index && !middle && !ring && !pinky) {
    return thumb ? "thumbs_up" : "fist";
  }
  if (index && middle && !ring && !pinky) {
    return "peace";
  }
  if (index && !middle && !ring && !pinky) {
    return "pointing";
  }
  if (thumb && !index && !middle && !ring && !pinky) {
    return "thumbs_up";
  }

  return null;
}

const GESTURE_LABELS = {
  open_palm: "Open palm",
  fist: "Fist",
  peace: "Peace sign",
  pointing: "Pointing",
  thumbs_up: "Thumbs up",
};

export function gestureLabel(id) {
  return GESTURE_LABELS[id] ?? id;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}
