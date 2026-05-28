const SAMPLE_WIDTH = 160;
const SAMPLE_HEIGHT = 120;
const COOLDOWN_MS = 400;

/**
 * Pixel-diff motion detector (no ML). Downscales frames for performance.
 */
export function createMotionDetector({ onEvent, getSensitivity }) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let previous = null;
  let lastEmit = 0;

  function reset() {
    previous = null;
    lastEmit = 0;
  }

  /**
   * @param {HTMLVideoElement} video
   */
  function tick(video) {
    if (video.readyState < 2) return;

    ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const frame = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);

    if (!previous) {
      previous = frame.data.slice();
      return;
    }

    let diff = 0;
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      diff +=
        Math.abs(data[i] - previous[i]) +
        Math.abs(data[i + 1] - previous[i + 1]) +
        Math.abs(data[i + 2] - previous[i + 2]);
    }
    previous.set(data);

    const normalized = diff / (SAMPLE_WIDTH * SAMPLE_HEIGHT * 3 * 255);
    const threshold = sensitivityToThreshold(getSensitivity());

    if (normalized > threshold && Date.now() - lastEmit > COOLDOWN_MS) {
      lastEmit = Date.now();
      const intensity = Math.round(normalized * 100);
      onEvent({
        label: "Motion detected",
        detail: `Intensity ${intensity}% (threshold ${Math.round(threshold * 100)}%)`,
        meta: { intensity, normalized },
      });
    }
  }

  return { tick, reset };
}

/** Slider 1–100 → threshold ~0.02–0.12 */
function sensitivityToThreshold(sliderValue) {
  const t = 1 - (sliderValue - 1) / 99;
  return 0.02 + t * 0.1;
}
