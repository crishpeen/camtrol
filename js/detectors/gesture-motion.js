/**
 * Temporal hand gestures: wave, pinch zoom in/out.
 */

const LM = { WRIST: 0, THUMB_TIP: 4, INDEX_TIP: 8, MIDDLE_MCP: 9 };

const WAVE_WINDOW_MS = 1800;
const WAVE_MIN_PEAKS = 2;
const WAVE_MIN_AMP_RATIO = 0.07;
const WAVE_COOLDOWN_MS = 2500;

const PINCH_ZOOM_WINDOW_MS = 700;
const PINCH_ZOOM_DELTA_RATIO = 0.1;
const PINCH_ZOOM_COOLDOWN_MS = 900;
const PINCH_MIN_STRENGTH = 0.42;

/**
 * @param {{ x: number, y: number, z?: number }} a
 * @param {{ x: number, y: number, z?: number }} b
 */
/**
 * @param {{ dist: number }[]} samples
 */
function avgDist(samples) {
  if (!samples.length) return 0;
  return samples.reduce((s, x) => s + x.dist, 0) / samples.length;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(dx, dy, dz);
}

/**
 * Normalized thumb–index tip distance (lower = tighter pinch).
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 */
export function pinchDistanceRatio(keypoints) {
  const palm = Math.max(dist(keypoints[5], keypoints[17]), 1e-6);
  return dist(keypoints[LM.THUMB_TIP], keypoints[LM.INDEX_TIP]) / palm;
}

/**
 * @param {{ x: number, y: number, z?: number }[]} keypoints
 */
export function pinchStrength(keypoints) {
  const ratio = pinchDistanceRatio(keypoints);
  if (ratio > 0.35) return 0;
  return Math.min(1, (0.35 - ratio) / 0.22);
}

export function createMotionGestureTracker() {
  /** @type {Map<string, {
   *   wave: { samples: { t: number, x: number }[], lastEmit: number },
   *   pinch: { samples: { t: number, dist: number }[], lastZoomIn: number, lastZoomOut: number, wasPinching: boolean }
   * }>} */
  const hands = new Map();

  function reset() {
    hands.clear();
  }

  /**
   * @param {{ x: number, y: number, z?: number }[]} keypoints
   * @param {number} now
   * @param {number} [frameWidth]
   * @param {{ handKey?: string, openPalm?: boolean }} [hints]
   * @returns {{ id: string, confidence: number, detail?: string } | null}
   */
  function push(keypoints, now, frameWidth = 640, hints = {}) {
    if (!keypoints || keypoints.length < 21) return null;

    const handKey = hints.handKey ?? "hand";
    let state = hands.get(handKey);
    if (!state) {
      state = {
        wave: { samples: [], lastEmit: 0 },
        pinch: { samples: [], lastZoomIn: 0, lastZoomOut: 0, wasPinching: false },
      };
      hands.set(handKey, state);
    }

    const pinchResult = trackPinchZoom(state.pinch, keypoints, now);
    if (pinchResult) return pinchResult;

    const waveResult = trackWave(state.wave, keypoints, now, frameWidth, hints.openPalm);
    if (waveResult) return waveResult;

    return null;
  }

  /**
   * @param {{ samples: { t: number, dist: number }[], lastZoomIn: number, lastZoomOut: number, wasPinching: boolean }} pinch
   */
  function trackPinchZoom(pinch, keypoints, now) {
    const strength = pinchStrength(keypoints);
    const dist = pinchDistanceRatio(keypoints);
    const pinching = dist < 0.3 || strength >= PINCH_MIN_STRENGTH;

    if (pinching) {
      pinch.samples.push({ t: now, dist });
      pinch.wasPinching = true;
    } else if (!pinching && pinch.wasPinching) {
      pinch.wasPinching = false;
    }

    pinch.samples = pinch.samples.filter((s) => now - s.t < PINCH_ZOOM_WINDOW_MS);

    if (pinch.samples.length < 5) return null;

    const first = pinch.samples[0].dist;
    const last = pinch.samples[pinch.samples.length - 1].dist;
    const base = Math.max(first, 1e-6);
    const relDelta = (last - first) / base;

    if (pinching && relDelta < -PINCH_ZOOM_DELTA_RATIO && now - pinch.lastZoomIn > PINCH_ZOOM_COOLDOWN_MS) {
      pinch.lastZoomIn = now;
      pinch.samples = pinch.samples.slice(-2);
      const pct = Math.round(Math.abs(relDelta) * 100);
      return {
        id: "zoom_in",
        confidence: Math.min(1, strength * 0.5 + 0.5),
        detail: `Pinch closed ${pct}%`,
      };
    }

    if (pinching && relDelta > PINCH_ZOOM_DELTA_RATIO && now - pinch.lastZoomOut > PINCH_ZOOM_COOLDOWN_MS) {
      pinch.lastZoomOut = now;
      pinch.samples = pinch.samples.slice(-2);
      const pct = Math.round(relDelta * 100);
      return {
        id: "zoom_out",
        confidence: Math.min(1, strength * 0.5 + 0.5),
        detail: `Pinch opened ${pct}%`,
      };
    }

    if (!pinching) return null;

    return null;
  }

  /**
   * @param {{ samples: { t: number, x: number }[], lastEmit: number }} wave
   */
  function trackWave(wave, keypoints, now, frameWidth, openPalm) {
    const wrist = keypoints[LM.WRIST];
    const normX = wrist.x / Math.max(frameWidth, 1);

    wave.samples.push({ t: now, x: normX });
    wave.samples = wave.samples.filter((s) => now - s.t < WAVE_WINDOW_MS);

    if (wave.samples.length < 10 || now - wave.lastEmit < WAVE_COOLDOWN_MS) {
      return null;
    }

    const xs = wave.samples.map((s) => s.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const amp = maxX - minX;

    if (amp < WAVE_MIN_AMP_RATIO) return null;

    let peaks = 0;
    for (let i = 1; i < xs.length - 1; i++) {
      const prev = xs[i - 1];
      const cur = xs[i];
      const next = xs[i + 1];
      if ((cur > prev && cur > next) || (cur < prev && cur < next)) {
        peaks += 1;
      }
    }

    const minPeaks = openPalm ? 3 : WAVE_MIN_PEAKS * 2;
    if (peaks < minPeaks) return null;

    wave.lastEmit = now;
    wave.samples = wave.samples.slice(-5);

    return {
      id: "wave",
      confidence: Math.min(1, 0.55 + amp * 2 + (openPalm ? 0.15 : 0)),
      detail: openPalm ? "Open palm wave" : "Side-to-side wave",
    };
  }

  return { push, reset, pinchStrength, pinchDistanceRatio };
}

import { gestureLabel } from "./gestures.js";

export function motionGestureLabel(id) {
  return gestureLabel(id);
}
