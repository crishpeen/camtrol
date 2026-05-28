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

/** @typedef {{ extended: boolean, strength: number }} FingerState */

/**
 * Palm-relative finger extension (robust to hand rotation vs wrist-distance heuristics).
 * A finger is extended when the tip lies beyond the DIP joint along the MCP→PIP direction.
 *
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

  // Tip must be clearly past DIP and PIP along the finger.
  const lengthRatio = tipToMcp / Math.max(dipToMcp, 1e-6);
  const pastPip = tipToMcp > pipToMcp * 1.08;

  // Direction: tip continues the PIP→DIP vector (finger straightening).
  const boneX = dip.x - pip.x;
  const boneY = dip.y - pip.y;
  const extX = tip.x - dip.x;
  const extY = tip.y - dip.y;
  const boneLen = Math.hypot(boneX, boneY) || 1e-6;
  const alignment = (boneX * extX + boneY * extY) / (boneLen * (Math.hypot(extX, extY) || 1e-6));

  const extended = lengthRatio > 1.1 && pastPip && alignment > 0.12;
  const curled = lengthRatio < 1.05 || (!pastPip && lengthRatio < 1.08);

  return {
    extended,
    strength: extended ? Math.min(1, (lengthRatio - 1) * 2) : curled ? 0 : 0.35,
  };
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {"Left" | "Right" | string} [handedness]
 * @returns {FingerState}
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

  const extended =
    spreadDelta > 0.14 &&
    spreadRatio > 1.1 &&
    lengthRatio > 1.04 &&
    (lateralNorm > -0.08 || spreadDelta > 0.22);

  const curled = spreadDelta < 0.06 && spreadRatio < 1.08 && lengthRatio < 1.06;

  return {
    extended,
    strength: extended
      ? Math.min(1, spreadDelta * 2.5)
      : curled
        ? 0
        : 0.25,
  };
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {"Left" | "Right" | string} [handedness]
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

/**
 * @param {FingerState} state
 */
function isExtended(state) {
  return state.extended && state.strength >= 0.4;
}

/**
 * @param {FingerState} state
 */
function isCurled(state) {
  return !state.extended && state.strength < 0.35;
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {"Left" | "Right" | string} [handedness]
 * @returns {{ id: string, confidence: number } | null}
 */
export function classifyGesture(keypoints, handedness) {
  if (!keypoints || keypoints.length < 21) return null;

  const f = getFingerStates(keypoints, handedness);

  const indexUp = isExtended(f.index);
  const middleUp = isExtended(f.middle);
  const ringUp = isExtended(f.ring);
  const pinkyUp = isExtended(f.pinky);
  const thumbUp = isExtended(f.thumb);

  const indexDown = isCurled(f.index);
  const middleDown = isCurled(f.middle);
  const ringDown = isCurled(f.ring);
  const pinkyDown = isCurled(f.pinky);
  const thumbDown = isCurled(f.thumb);

  const fingersUp = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

  // --- Specific gestures first (never default to fist) ---

  if (indexUp && middleUp && ringDown && pinkyDown && !thumbUp) {
    return score("peace", 0.85 + f.index.strength * 0.1);
  }

  if (indexUp && middleDown && ringDown && pinkyDown && !thumbUp) {
    return score("pointing", 0.8 + f.index.strength * 0.15);
  }

  if (thumbUp && indexDown && middleDown && ringDown && pinkyDown) {
    return score("thumbs_up", 0.85 + f.thumb.strength * 0.1);
  }

  if (fingersUp >= 4 && indexUp && middleUp && ringUp && pinkyUp) {
    const palmScore = (f.index.strength + f.middle.strength + f.ring.strength + f.pinky.strength) / 4;
    return score("open_palm", 0.75 + palmScore * 0.2);
  }

  if (indexDown && middleDown && ringDown && pinkyDown && thumbDown) {
    return score("fist", 0.9);
  }

  // Relaxed fist: all fingers clearly not extended
  if (!indexUp && !middleUp && !ringUp && !pinkyUp && !thumbUp && fingersUp === 0) {
    const maxStrength = Math.max(f.index.strength, f.middle.strength, f.ring.strength, f.pinky.strength);
    if (maxStrength < 0.4) {
      return score("fist", 0.7);
    }
  }

  return null;
}

/**
 * @param {string} id
 * @param {number} confidence
 */
function score(id, confidence) {
  return { id, confidence: Math.min(1, confidence) };
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
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(dx, dy, dz);
}
