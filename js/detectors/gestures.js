/** MediaPipe hand landmark indices */
export const LM = {
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

/** @typedef {{ extended: boolean, strength: number }} FingerState */
/** @typedef {{ extended: boolean, vertical: 'up' | 'down' | 'neutral', strength: number, spreadDelta: number, verticalNorm: number }} ThumbState */

/**
 * @param {{ x: number, y: number, z?: number }} a
 * @param {{ x: number, y: number, z?: number }} b
 * @param {{ x: number, y: number, z?: number }} c
 */
function jointAngleRad(a, b, c) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const m1 = Math.hypot(v1x, v1y) || 1e-6;
  const m2 = Math.hypot(v2x, v2y) || 1e-6;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return Math.acos(cos);
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 */
export function palmSpan(keypoints) {
  return Math.max(
    dist(keypoints[LM.INDEX_MCP], keypoints[LM.PINKY_MCP]),
    dist(keypoints[LM.INDEX_MCP], keypoints[LM.WRIST]),
    1e-6
  );
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {number} tipIdx
 * @param {number} dipIdx
 * @param {number} pipIdx
 * @param {number} mcpIdx
 * @returns {FingerState}
 */
function fingerState(keypoints, tipIdx, dipIdx, pipIdx, mcpIdx) {
  const tip = keypoints[tipIdx];
  const dip = keypoints[dipIdx];
  const pip = keypoints[pipIdx];
  const mcp = keypoints[mcpIdx];

  const tipToMcp = dist(tip, mcp);
  const dipToMcp = dist(dip, mcp);
  const pipToMcp = dist(pip, mcp);

  const lengthRatio = tipToMcp / Math.max(dipToMcp, 1e-6);
  const pastPip = tipToMcp > pipToMcp * 1.06;
  const pipAngle = jointAngleRad(mcp, pip, dip);
  const dipAngle = jointAngleRad(pip, dip, tip);
  const straight = (pipAngle + dipAngle) / 2;

  const boneX = dip.x - pip.x;
  const boneY = dip.y - pip.y;
  const extX = tip.x - dip.x;
  const extY = tip.y - dip.y;
  const boneLen = Math.hypot(boneX, boneY) || 1e-6;
  const alignment = (boneX * extX + boneY * extY) / (boneLen * (Math.hypot(extX, extY) || 1e-6));

  const extended =
    straight > 2.35 &&
    lengthRatio > 1.08 &&
    pastPip &&
    alignment > 0.1;
  const curled = straight < 2.05 && lengthRatio < 1.06;

  const angleStrength = extended ? Math.min(1, (straight - 2.2) * 1.4) : 0;
  const lenStrength = extended ? Math.min(1, (lengthRatio - 1) * 2) : 0;

  return {
    extended,
    strength: extended
      ? Math.min(1, angleStrength * 0.5 + lenStrength * 0.5)
      : curled
        ? 0
        : 0.3,
  };
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {string} [handedness]
 * @returns {ThumbState}
 */
function thumbState(keypoints, handedness) {
  const tip = keypoints[LM.THUMB_TIP];
  const ip = keypoints[LM.THUMB_IP];
  const mcp = keypoints[LM.THUMB_MCP];
  const indexMcp = keypoints[LM.INDEX_MCP];
  const wrist = keypoints[LM.WRIST];
  const palmWidth = Math.max(dist(indexMcp, wrist), 1e-6);

  const tipToMcp = dist(tip, mcp);
  const ipToMcp = dist(ip, mcp);
  const lengthRatio = tipToMcp / Math.max(ipToMcp, 1e-6);

  const tipSpread = dist(tip, indexMcp);
  const ipSpread = dist(ip, indexMcp);
  const spreadRatio = tipSpread / Math.max(ipSpread, 1e-6);
  const spreadDelta = (tipSpread - ipSpread) / palmWidth;

  const isRight = /^right$/i.test(handedness ?? "");
  const lateral = isRight ? tip.x - ip.x : ip.x - tip.x;
  const lateralNorm = lateral / palmWidth;

  const verticalNorm = (tip.y - mcp.y) / palmWidth;

  const extended =
    spreadDelta > 0.1 &&
    spreadRatio > 1.06 &&
    lengthRatio > 1.03 &&
    (lateralNorm > -0.12 || spreadDelta > 0.16);

  const curled = spreadDelta < 0.05 && spreadRatio < 1.06 && lengthRatio < 1.05;

  let vertical = "neutral";
  // Require thumb spread away from palm for vertical up/down (avoids curled thumb reading as "up")
  if (spreadDelta > 0.05 && verticalNorm < -0.06) vertical = "up";
  else if (spreadDelta > 0.05 && verticalNorm > 0.08) vertical = "down";
  else if (extended && spreadDelta > 0.08) {
    if (verticalNorm < -0.05) vertical = "up";
    else if (verticalNorm > 0.07) vertical = "down";
  }

  return {
    extended,
    vertical,
    spreadDelta,
    verticalNorm,
    strength: extended
      ? Math.min(1, spreadDelta * 2.5)
      : curled
        ? 0
        : vertical === "up"
          ? 0.45
          : 0.25,
  };
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {string} [handedness]
 */
export function getFingerStates(keypoints, handedness) {
  return {
    thumb: thumbState(keypoints, handedness),
    index: fingerState(keypoints, LM.INDEX_TIP, LM.INDEX_DIP, LM.INDEX_PIP, LM.INDEX_MCP),
    middle: fingerState(keypoints, LM.MIDDLE_TIP, LM.MIDDLE_DIP, LM.MIDDLE_PIP, LM.MIDDLE_MCP),
    ring: fingerState(keypoints, LM.RING_TIP, LM.RING_DIP, LM.RING_PIP, LM.RING_MCP),
    pinky: fingerState(keypoints, LM.PINKY_TIP, LM.PINKY_DIP, LM.PINKY_PIP, LM.PINKY_MCP),
  };
}

/** @param {FingerState} state */
function isExtended(state) {
  return state.extended && state.strength >= 0.45;
}

/** @param {FingerState} state */
function isCurled(state) {
  return !state.extended && state.strength < 0.32;
}

/**
 * Lenient check — thumb raised with other fingers folded (handles tilted hand to camera).
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {ReturnType<typeof getFingerStates>} f
 */
function isThumbsUpPose(keypoints, f) {
  if (!fingersFolded(f)) return false;

  const tip = keypoints[LM.THUMB_TIP];
  const mcp = keypoints[LM.THUMB_MCP];
  const indexMcp = keypoints[LM.INDEX_MCP];
  const wrist = keypoints[LM.WRIST];
  const palmWidth = Math.max(dist(indexMcp, wrist), 1e-6);

  const thumbPointingUp = f.thumb.vertical === "up" || f.thumb.verticalNorm < -0.055;
  const thumbAboveKnuckles = tip.y < indexMcp.y + palmWidth * 0.08;
  const thumbAwayFromPalm = f.thumb.extended || f.thumb.spreadDelta > 0.08;
  const thumbLongerThanFolded = dist(tip, wrist) > dist(keypoints[LM.THUMB_IP], wrist) * 1.02;

  return thumbPointingUp && thumbAboveKnuckles && thumbAwayFromPalm && thumbLongerThanFolded;
}

/** @param {ThumbState} thumb */
function isThumbDownPose(keypoints, f) {
  if (!fingersFolded(f)) return false;
  return (
    f.thumb.vertical === "down" &&
    (f.thumb.extended || f.thumb.verticalNorm > 0.1) &&
    keypoints[LM.THUMB_TIP].y > keypoints[LM.INDEX_MCP].y
  );
}

/** Other fingers not extended (lenient for thumbs poses). */
function fingersFolded(f) {
  return [f.index, f.middle, f.ring, f.pinky].every(
    (finger) => !finger.extended || finger.strength < 0.52
  );
}

/** True fist: all digits curled including thumb wrapped in. */
function isFistPose(keypoints, f) {
  if (isThumbsUpPose(keypoints, f) || isThumbDownPose(keypoints, f)) return false;

  const digitsCurled = [f.index, f.middle, f.ring, f.pinky].every((finger) => !finger.extended);
  const thumbWrapped = f.thumb.spreadDelta < 0.08 && !f.thumb.extended && f.thumb.vertical !== "up";

  const allCurled = [f.index, f.middle, f.ring, f.pinky].every(isCurled);
  if (!digitsCurled || !allCurled || !thumbWrapped) return false;

  const span = palmSpan(keypoints);
  const thumbSpread = dist(keypoints[LM.THUMB_TIP], keypoints[LM.INDEX_MCP]) / span;
  if (thumbSpread > 0.55 && f.thumb.verticalNorm < -0.06) return false;

  return true;
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 */
export function isPinchPose(keypoints) {
  const ratio = dist(keypoints[LM.THUMB_TIP], keypoints[LM.INDEX_TIP]) / palmSpan(keypoints);
  return ratio < 0.22;
}

/**
 * Rock / horns: index + pinky extended, middle + ring curled.
 */
function isRockOn(f) {
  return (
    isExtended(f.index) &&
    isExtended(f.pinky) &&
    isCurled(f.middle) &&
    isCurled(f.ring) &&
    f.thumb.vertical !== "up"
  );
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {string} [handedness]
 * @returns {{ id: string, confidence: number } | null}
 */
export function classifyGesture(keypoints, handedness) {
  if (!keypoints || keypoints.length < 21) return null;

  const f = getFingerStates(keypoints, handedness);

  const indexUp = isExtended(f.index);
  const middleUp = isExtended(f.middle);
  const ringUp = isExtended(f.ring);
  const pinkyUp = isExtended(f.pinky);

  const indexDown = isCurled(f.index);
  const middleDown = isCurled(f.middle);
  const ringDown = isCurled(f.ring);
  const pinkyDown = isCurled(f.pinky);
  const fingersUp = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;
  const pinch = isPinchPose(keypoints);
  const thumbsUp = isThumbsUpPose(keypoints, f);
  const thumbsDown = isThumbDownPose(keypoints, f);
  const thumbIdle = !thumbsUp && !thumbsDown;

  if (thumbsUp) {
    return score("thumbs_up", 0.9 + Math.min(0.08, Math.abs(f.thumb.verticalNorm) * 2));
  }

  if (thumbsDown) {
    return score("thumbs_down", 0.88 + f.thumb.strength * 0.1);
  }

  if (pinch && !middleUp && !ringUp) {
    return score("pinch", 0.88);
  }

  if (middleUp && indexDown && ringDown && pinkyDown && thumbIdle) {
    return score("middle_finger", 0.88 + f.middle.strength * 0.1);
  }

  if (isRockOn(f)) {
    return score("rock_on", 0.82);
  }

  if (indexUp && middleUp && ringDown && pinkyDown && thumbIdle) {
    return score("peace", 0.85 + f.index.strength * 0.1);
  }

  if (indexUp && middleDown && ringDown && pinkyDown && thumbIdle) {
    return score("pointing", 0.8 + f.index.strength * 0.15);
  }

  if (fingersUp >= 4 && indexUp && middleUp && ringUp && pinkyUp) {
    const palmScore = (f.index.strength + f.middle.strength + f.ring.strength + f.pinky.strength) / 4;
    return score("open_palm", 0.75 + palmScore * 0.2);
  }

  if (isFistPose(keypoints, f)) {
    const curlScore = [f.index, f.middle, f.ring, f.pinky].filter((x) => isCurled(x)).length / 4;
    return score("fist", 0.86 + curlScore * 0.1);
  }

  return null;
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {string} [handedness]
 * @returns {{ id: string, confidence: number } | null}
 */
export function classifyGestureWithQuality(keypoints, handedness, qualityScore = 1) {
  const raw = classifyGesture(keypoints, handedness);
  if (!raw) return null;
  const q = Math.max(0.5, Math.min(1, qualityScore));
  return { id: raw.id, confidence: Math.min(1, raw.confidence * (0.75 + q * 0.25)) };
}

/** @param {string} id @param {number} confidence */
function score(id, confidence) {
  return { id, confidence: Math.min(1, confidence) };
}

export const GESTURE_LABELS = {
  open_palm: "Open palm",
  fist: "Fist",
  peace: "Peace sign ✌️",
  pointing: "Pointing 👉",
  thumbs_up: "Thumbs up 👍",
  thumbs_down: "Thumbs down 👎",
  middle_finger: "Middle finger 🖕",
  rock_on: "Rock on 🤘",
  pinch: "Pinch 🤏",
  wave: "Wave 👋",
  zoom_in: "Zoom in 🔍",
  zoom_out: "Zoom out 🔎",
  tap: "Tap",
  double_tap: "Double tap",
  long_press: "Long press",
  swipe_left: "Swipe left",
  swipe_right: "Swipe right",
  swipe_up: "Swipe up",
  swipe_down: "Swipe down",
  scroll_up: "Scroll up",
  scroll_down: "Scroll down",
  drag_up: "Drag up",
  drag_down: "Drag down",
  drag_left: "Drag left",
  drag_right: "Drag right",
  rotate: "Rotate (pinch twist)",
};

export function gestureLabel(id) {
  return GESTURE_LABELS[id] ?? id;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(dx, dy, dz);
}
