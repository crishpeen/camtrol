/**
 * Touchscreen-like gestures from index/palm motion over time.
 */

import { pinchDistanceRatio } from "./gesture-motion.js";
import { gestureLabel } from "./gestures.js";

const LM = { WRIST: 0, THUMB_TIP: 4, INDEX_TIP: 8, MIDDLE_MCP: 9 };

const TRAIL_MS = 600;
const SWIPE_MAX_MS = 450;
const SWIPE_MIN_DIST = 0.1;
const TAP_MAX_DIST = 0.045;
const TAP_MAX_MS = 280;
const DOUBLE_TAP_MS = 500;
const LONG_PRESS_MS = 700;
const LONG_PRESS_MAX_MOVE = 0.035;
const SCROLL_MIN_DY = 0.12;
const SCROLL_MIN_MS = 350;
const ROTATE_MIN_DEG = 22;
const COOLDOWN = {
  swipe: 800,
  tap: 400,
  double_tap: 700,
  long_press: 1200,
  scroll: 700,
  rotate: 900,
  drag: 600,
};

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 * @param {{ pointing?: boolean, pinching?: boolean, openPalm?: boolean }} hints
 */
function pointerPosition(keypoints, hints) {
  if (hints.pinching) {
    const thumb = keypoints[LM.THUMB_TIP];
    const index = keypoints[LM.INDEX_TIP];
    return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
  }
  if (hints.pointing) {
    return keypoints[LM.INDEX_TIP];
  }
  const wrist = keypoints[LM.WRIST];
  const mid = keypoints[LM.MIDDLE_MCP];
  return { x: (wrist.x + mid.x) / 2, y: (wrist.y + mid.y) / 2 };
}

function pinchAngle(keypoints) {
  const thumb = keypoints[LM.THUMB_TIP];
  const index = keypoints[LM.INDEX_TIP];
  return Math.atan2(index.y - thumb.y, index.x - thumb.x);
}

function normPos(p, frameWidth, frameHeight) {
  return {
    x: p.x / Math.max(frameWidth, 1),
    y: p.y / Math.max(frameHeight, 1),
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function createTouchGestureTracker() {
  /** @type {Map<string, object>} */
  const hands = new Map();

  function reset() {
    hands.clear();
  }

  /**
   * @param {{ x: number, y: number, z?: number }[]} keypoints
   * @param {number} now
   * @param {number} frameWidth
   * @param {number} frameHeight
   * @param {{ handKey?: string, pointing?: boolean, pinching?: boolean, openPalm?: boolean }} hints
   */
  function push(keypoints, now, frameWidth, frameHeight, hints = {}) {
    if (!keypoints?.length) return null;

    const handKey = hints.handKey ?? "hand";
    let s = hands.get(handKey);
    if (!s) {
      s = {
        trail: [],
        lastTap: 0,
        lastTapPos: null,
        tapCount: 0,
        longPressAnchor: null,
        longPressFired: false,
        lastEmit: {},
        rotateSamples: [],
      };
      hands.set(handKey, s);
    }

    const raw = pointerPosition(keypoints, hints);
    const p = normPos(raw, frameWidth, frameHeight);
    s.trail.push({ t: now, x: p.x, y: p.y });
    s.trail = s.trail.filter((pt) => now - pt.t < TRAIL_MS);

    const canEmit = (id) => now - (s.lastEmit[id] ?? 0) > (COOLDOWN[id] ?? 800);

    const rotateHit = trackRotate(s, keypoints, now, hints.pinching, canEmit);
    if (rotateHit) return rotateHit;

    const longHit = trackLongPress(s, p, now, canEmit);
    if (longHit) return longHit;

    const scrollHit = trackScroll(s, now, hints.pointing, canEmit);
    if (scrollHit) return scrollHit;

    const swipeHit = trackSwipe(s, now, canEmit);
    if (swipeHit) return swipeHit;

    const dragHit = trackDrag(s, now, canEmit);
    if (dragHit) return dragHit;

    const tapHit = trackTap(s, p, now, canEmit);
    if (tapHit) return tapHit;

    return null;
  }

  function trackRotate(s, keypoints, now, pinching, canEmit) {
    if (!pinching || pinchDistanceRatio(keypoints) > 0.32) {
      s.rotateSamples = [];
      return null;
    }
    s.rotateSamples.push({ t: now, angle: pinchAngle(keypoints) });
    s.rotateSamples = s.rotateSamples.filter((x) => now - x.t < 500);
    if (s.rotateSamples.length < 5 || !canEmit("rotate")) return null;

    const first = s.rotateSamples[0].angle;
    const last = s.rotateSamples[s.rotateSamples.length - 1].angle;
    let delta = ((last - first) * 180) / Math.PI;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;

    if (Math.abs(delta) < ROTATE_MIN_DEG) return null;

    s.lastEmit.rotate = now;
    s.rotateSamples = s.rotateSamples.slice(-2);
    const dir = delta > 0 ? "clockwise" : "counter-clockwise";
    return {
      id: "rotate",
      confidence: Math.min(1, Math.abs(delta) / 45),
      detail: `${dir} (${Math.round(Math.abs(delta))}°)`,
    };
  }

  function trackLongPress(s, p, now, canEmit) {
    if (!s.longPressAnchor) {
      s.longPressAnchor = { ...p, t: now };
      s.longPressFired = false;
      return null;
    }
    const moved = dist(p, s.longPressAnchor);
    if (moved > LONG_PRESS_MAX_MOVE) {
      s.longPressAnchor = { ...p, t: now };
      s.longPressFired = false;
      return null;
    }
    if (!s.longPressFired && now - s.longPressAnchor.t >= LONG_PRESS_MS && canEmit("long_press")) {
      s.longPressFired = true;
      s.lastEmit.long_press = now;
      return { id: "long_press", confidence: 0.88, detail: "Hold steady" };
    }
    return null;
  }

  function trackScroll(s, now, pointing, canEmit) {
    if (!pointing || s.trail.length < 6) return null;
    const window = s.trail.filter((pt) => now - pt.t < SCROLL_MIN_MS + 100);
    if (window.length < 5) return null;
    const dy = window[window.length - 1].y - window[0].y;
    if (Math.abs(dy) < SCROLL_MIN_DY || !canEmit("scroll")) return null;
    const dx = window[window.length - 1].x - window[0].x;
    if (Math.abs(dx) > Math.abs(dy) * 0.8) return null;

    s.lastEmit.scroll = now;
    s.trail = s.trail.slice(-2);
    return {
      id: dy < 0 ? "scroll_up" : "scroll_down",
      confidence: Math.min(1, Math.abs(dy) * 3),
      detail: "Index finger drag",
    };
  }

  function trackSwipe(s, now, canEmit) {
    if (s.trail.length < 4) return null;
    const recent = s.trail.filter((pt) => now - pt.t < SWIPE_MAX_MS);
    if (recent.length < 3) return null;

    const dx = recent[recent.length - 1].x - recent[0].x;
    const dy = recent[recent.length - 1].y - recent[0].y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const d = Math.hypot(dx, dy);

    if (d < SWIPE_MIN_DIST) return null;

    let id = null;
    if (adx > ady * 1.4) {
      id = dx > 0 ? "swipe_right" : "swipe_left";
    } else if (ady > adx * 1.4) {
      id = dy > 0 ? "swipe_down" : "swipe_up";
    }
    if (!id || !canEmit("swipe")) return null;

    s.lastEmit.swipe = now;
    s.trail = s.trail.slice(-2);
    s.longPressAnchor = null;
    return {
      id,
      confidence: Math.min(1, d * 4),
      detail: `Quick ${id.replace("_", " ")}`,
    };
  }

  function trackDrag(s, now, canEmit) {
    const slow = s.trail.filter((pt) => now - pt.t < 500);
    if (slow.length < 8) return null;
    const dx = slow[slow.length - 1].x - slow[0].x;
    const dy = slow[slow.length - 1].y - slow[0].y;
    const d = Math.hypot(dx, dy);
    const dt = slow[slow.length - 1].t - slow[0].t;
    if (d < SWIPE_MIN_DIST * 1.2 || d > SWIPE_MIN_DIST * 2.2 || dt < 400) return null;
    if (!canEmit("drag")) return null;

    s.lastEmit.drag = now;
    s.trail = s.trail.slice(-3);
    let dir = "drag";
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? "drag_right" : "drag_left";
    else dir = dy > 0 ? "drag_down" : "drag_up";

    return { id: dir, confidence: 0.75, detail: "Slow pan" };
  }

  function trackTap(s, p, now, canEmit) {
    if (s.trail.length < 3) return null;
    const recent = s.trail.filter((pt) => now - pt.t < TAP_MAX_MS);
    if (recent.length < 2) return null;

    const d = dist(recent[recent.length - 1], recent[0]);
    const dt = recent[recent.length - 1].t - recent[0].t;
    if (d > TAP_MAX_DIST || dt > TAP_MAX_MS) return null;

    if (now - s.lastTap < DOUBLE_TAP_MS && s.lastTapPos && dist(p, s.lastTapPos) < TAP_MAX_DIST * 1.5) {
      s.tapCount += 1;
    } else {
      s.tapCount = 1;
    }
    s.lastTap = now;
    s.lastTapPos = { ...p };

    if (s.tapCount >= 2 && canEmit("double_tap")) {
      s.tapCount = 0;
      s.lastEmit.double_tap = now;
      s.trail = [];
      return { id: "double_tap", confidence: 0.9, detail: "Two quick taps" };
    }

    if (canEmit("tap")) {
      s.lastEmit.tap = now;
      s.trail = [];
      return { id: "tap", confidence: 0.85, detail: "Quick touch" };
    }
    return null;
  }

  return { push, reset };
}

export function touchGestureLabel(id) {
  return gestureLabel(id);
}
