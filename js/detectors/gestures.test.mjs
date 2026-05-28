import { classifyGesture, getFingerStates, isPinchPose } from "./gestures.js";
import { createGestureStabilizer } from "./gesture-stabilizer.js";
import { createMotionGestureTracker, pinchStrength } from "./gesture-motion.js";

function pt(x, y, z = 0) {
  return { x, y, z, name: "" };
}

/**
 * @param {{ index?: boolean, middle?: boolean, ring?: boolean, pinky?: boolean, thumb?: boolean | 'up' | 'down' }} pose
 */
function mockHand(pose, handedness = "Right") {
  const { index = false, middle = false, ring = false, pinky = false, thumb = false } = pose;
  const kp = new Array(21).fill(null).map(() => pt(0.5, 0.5));

  kp[0] = pt(0.5, 0.9);
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

  if (thumb === "down") {
    kp[4] = pt(0.32, 0.84);
    kp[3] = pt(0.34, 0.76);
  } else if (thumb === true || thumb === "up") {
    kp[4] = pt(0.28, 0.55);
  } else {
    kp[4] = pt(0.36, 0.64);
  }

  return { keypoints: kp, handedness };
}

function mockPinchHand() {
  const hand = mockHand({ index: true, middle: false, ring: false, pinky: false, thumb: "up" });
  hand.keypoints[8] = pt(0.4, 0.62);
  hand.keypoints[4] = pt(0.41, 0.63);
  hand.keypoints[3] = pt(0.39, 0.66);
  return hand;
}

function stabilizeMany(hand, frames = 10) {
  const s = createGestureStabilizer();
  let last = null;
  for (let i = 0; i < frames; i++) {
    last = s.push("r", classifyGesture(hand.keypoints, hand.handedness));
  }
  return last;
}

const staticCases = [
  ["peace", { index: true, middle: true, ring: false, pinky: false, thumb: false }],
  ["pointing", { index: true, middle: false, ring: false, pinky: false, thumb: false }],
  ["open_palm", { index: true, middle: true, ring: true, pinky: true, thumb: "up" }],
  ["fist", { index: false, middle: false, ring: false, pinky: false, thumb: false }],
  ["thumbs_up", { index: false, middle: false, ring: false, pinky: false, thumb: "up" }],
  ["thumbs_down", { index: false, middle: false, ring: false, pinky: false, thumb: "down" }],
  ["middle_finger", { index: false, middle: true, ring: false, pinky: false, thumb: false }],
  ["rock_on", { index: true, middle: false, ring: false, pinky: true, thumb: false }],
];

let passed = 0;
let total = staticCases.length + 2;

for (const [expected, pose] of staticCases) {
  const hand = mockHand(pose);
  const stable = stabilizeMany(hand);
  const ok = stable?.id === expected;
  if (ok) passed += 1;
  console.log(ok ? "✓" : "✗", expected, "→", stable?.id ?? "null");
}

const pinchHand = mockPinchHand();
const pinchOk = isPinchPose(pinchHand.keypoints) && stabilizeMany(pinchHand)?.id === "pinch";
if (pinchOk) passed += 1;
console.log(pinchOk ? "✓" : "✗", "pinch →", stabilizeMany(pinchHand)?.id, "strength", pinchStrength(pinchHand.keypoints).toFixed(2));

const motion = createMotionGestureTracker();
let zoomIn = null;
const t0 = Date.now();
for (let i = 0; i < 12; i++) {
  const hand = mockPinchHand();
  const close = i / 11;
  hand.keypoints[4] = pt(0.48 - close * 0.06, 0.63);
  hand.keypoints[8] = pt(0.52 - close * 0.065, 0.64);
  const hit = motion.push(hand.keypoints, t0 + i * 60, 640, { handKey: "r" });
  if (hit) zoomIn = hit;
}
const zoomOk = zoomIn?.id === "zoom_in";
if (zoomOk) passed += 1;
console.log(zoomOk ? "✓" : "✗", "zoom_in →", zoomIn?.id ?? "null");

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
