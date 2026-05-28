import assert from "node:assert/strict";
import test from "node:test";
import { clientPointToVideoFrame, normalizedCoverToVideo } from "./gaze-viewport.js";

test("normalizedCoverToVideo maps center when aspect ratios match", () => {
  const p = normalizedCoverToVideo(0.5, 0.5, 16 / 9, 16 / 9);
  assert.ok(Math.abs(p.x - 0.5) < 1e-6);
  assert.ok(Math.abs(p.y - 0.5) < 1e-6);
});

test("normalizedCoverToVideo crops wide video in a tall box", () => {
  const p = normalizedCoverToVideo(0.5, 0.5, 16 / 9, 9 / 16);
  assert.ok(p.x > 0.25 && p.x < 0.75);
  assert.ok(Math.abs(p.y - 0.5) < 1e-6);
});

test("clientPointToVideoFrame maps preview center to frame center", () => {
  const video = {
    videoWidth: 640,
    videoHeight: 480,
    getBoundingClientRect: () => ({
      left: 100,
      top: 50,
      width: 320,
      height: 240,
      right: 420,
      bottom: 290,
    }),
  };

  const mapped = clientPointToVideoFrame(
    /** @type {HTMLVideoElement} */ (video),
    260,
    170,
    { mirrorDisplay: false },
  );

  assert.ok(mapped);
  assert.equal(mapped.onPreview, true);
  assert.ok(Math.abs(mapped.x - 320) < 40);
  assert.ok(Math.abs(mapped.y - 240) < 40);
});

test("clientPointToVideoFrame mirrors horizontal position", () => {
  const video = {
    videoWidth: 100,
    videoHeight: 100,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
    }),
  };

  const plain = clientPointToVideoFrame(
    /** @type {HTMLVideoElement} */ (video),
    20,
    50,
    { mirrorDisplay: false },
  );
  const mirrored = clientPointToVideoFrame(
    /** @type {HTMLVideoElement} */ (video),
    20,
    50,
    { mirrorDisplay: true },
  );

  assert.ok(plain && mirrored);
  assert.ok(Math.abs(plain.x + mirrored.x - 100) < 2);
});
