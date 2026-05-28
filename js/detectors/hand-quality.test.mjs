import { assessHandQuality, keypointsForMetrics } from "./hand-quality.js";
import { LM } from "./gestures.js";

function pt(x, y) {
  return { x, y, z: 0 };
}

function mockPixelHand(w = 640, h = 480) {
  const kp = new Array(21).fill(null).map(() => pt(w * 0.5, h * 0.5));
  kp[LM.WRIST] = pt(w * 0.5, h * 0.75);
  kp[LM.INDEX_MCP] = pt(w * 0.42, h * 0.55);
  kp[LM.PINKY_MCP] = pt(w * 0.58, h * 0.55);
  kp[LM.MIDDLE_MCP] = pt(w * 0.5, h * 0.55);
  for (const [tip, mcp] of [
    [LM.INDEX_TIP, LM.INDEX_MCP],
    [LM.MIDDLE_TIP, LM.MIDDLE_MCP],
    [LM.RING_TIP, LM.RING_MCP],
    [LM.PINKY_TIP, LM.PINKY_MCP],
  ]) {
    kp[tip] = pt(kp[mcp].x, kp[mcp].y - h * 0.15);
  }
  kp[LM.THUMB_TIP] = pt(w * 0.32, h * 0.45);
  kp[LM.THUMB_MCP] = pt(w * 0.38, h * 0.52);
  return kp;
}

const raw = mockPixelHand();
const before = assessHandQuality(raw, 0.9);
const normalized = keypointsForMetrics(raw, 640, 480);
const after = assessHandQuality(normalized, 0.9);

if (before.ok) {
  console.error("✗ pixel coords should not pass quality without normalization");
  process.exit(1);
}
if (!after.ok) {
  console.error("✗ normalized hand should pass quality", after.reason);
  process.exit(1);
}
console.log("✓ hand-quality pixel vs normalized");
process.exit(0);
