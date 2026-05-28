import { classifyGesture, getFingerStates } from "./gestures.js";
import { createGestureStabilizer } from "./gesture-stabilizer.js";

function pt(x, y, z = 0) {
  return { x, y, z, name: "" };
}

/** Build a minimal 21-point hand with per-finger extension flags. */
function mockHand({ index, middle, ring, pinky, thumb }, handedness = "Right") {
  const kp = new Array(21).fill(null).map((_, i) => pt(0.5, 0.5));

  kp[0] = pt(0.5, 0.9); // wrist
  kp[5] = pt(0.45, 0.7);
  kp[9] = pt(0.5, 0.7);
  kp[13] = pt(0.55, 0.7);
  kp[17] = pt(0.6, 0.7);

  function setFinger(mcp, pip, dip, tip, extended) {
    kp[mcp] = pt(kp[mcp].x, kp[mcp].y);
    kp[pip] = pt(kp[mcp].x, kp[mcp].y - 0.08);
    if (extended) {
      kp[dip] = pt(kp[mcp].x, kp[mcp].y - 0.16);
      kp[tip] = pt(kp[mcp].x, kp[mcp].y - 0.28);
    } else {
      kp[dip] = pt(kp[mcp].x + 0.02, kp[pip].y - 0.02);
      kp[tip] = pt(kp[mcp].x + 0.03, kp[pip].y - 0.01);
    }
  }

  setFinger(5, 6, 7, 8, index);
  setFinger(9, 10, 11, 12, middle);
  setFinger(13, 14, 15, 16, ring);
  setFinger(17, 18, 19, 20, pinky);

  kp[1] = pt(0.38, 0.78);
  kp[2] = pt(0.36, 0.72);
  kp[3] = pt(0.34, 0.66);
  if (thumb) {
    kp[4] = pt(0.28, 0.55);
  } else {
    kp[4] = pt(0.36, 0.64);
  }

  return { keypoints: kp, handedness };
}

function stabilizeMany(hand, frames = 10) {
  const s = createGestureStabilizer();
  let last = null;
  for (let i = 0; i < frames; i++) {
    last = s.push("r", classifyGesture(hand.keypoints, hand.handedness));
  }
  return last;
}

const cases = [
  ["peace", { index: true, middle: true, ring: false, pinky: false, thumb: false }],
  ["pointing", { index: true, middle: false, ring: false, pinky: false, thumb: false }],
  ["open_palm", { index: true, middle: true, ring: true, pinky: true, thumb: true }],
  ["fist", { index: false, middle: false, ring: false, pinky: false, thumb: false }],
  ["thumbs_up", { index: false, middle: false, ring: false, pinky: false, thumb: true }],
];

let passed = 0;
for (const [expected, pose] of cases) {
  const hand = mockHand(pose);
  const raw = classifyGesture(hand.keypoints, hand.handedness);
  const stable = stabilizeMany(hand);
  const ok = stable?.id === expected;
  if (ok) passed += 1;
  console.log(
    ok ? "✓" : "✗",
    expected,
    "raw=",
    raw?.id ?? "null",
    "stable=",
    stable?.id ?? "null",
    "fingers=",
    Object.entries(getFingerStates(hand.keypoints, hand.handedness))
      .map(([k, v]) => `${k}:${v.extended ? "up" : "down"}`)
      .join(" ")
  );
}

console.log(`\n${passed}/${cases.length} passed`);
process.exit(passed === cases.length ? 0 : 1);
