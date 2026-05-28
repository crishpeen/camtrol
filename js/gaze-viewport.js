/**
 * Map client/viewport coordinates to webcam frame pixels (object-fit: cover).
 * @param {HTMLVideoElement} video
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ mirrorDisplay?: boolean }} [opts]
 * @returns {{ x: number, y: number, onPreview: boolean } | null}
 */
export function clientPointToVideoFrame(video, clientX, clientY, opts = {}) {
  const mirrorDisplay = opts.mirrorDisplay === true;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const rect = video.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const nx = (clientX - rect.left) / rect.width;
  const ny = (clientY - rect.top) / rect.height;
  const onPreview = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;

  let vx;
  let vy;

  if (onPreview) {
    const mapped = normalizedCoverToVideo(nx, ny, vw / vh, rect.width / rect.height);
    vx = mapped.x * vw;
    vy = mapped.y * vh;
  } else {
    const px = clientX / Math.max(window.innerWidth, 1);
    const py = clientY / Math.max(window.innerHeight, 1);
    vx = px * vw;
    vy = py * vh;
  }

  if (mirrorDisplay) {
    vx = vw - vx;
  }

  return {
    x: Math.max(0, Math.min(vw, vx)),
    y: Math.max(0, Math.min(vh, vy)),
    onPreview,
  };
}

/**
 * Normalized point in a cover-fitted box → normalized point on source media (0–1).
 * @param {number} nx
 * @param {number} ny
 * @param {number} mediaAspect width / height
 * @param {number} boxAspect width / height
 */
export function normalizedCoverToVideo(nx, ny, mediaAspect, boxAspect) {
  let sx;
  let sy;
  let sw;
  let sh;

  if (mediaAspect > boxAspect) {
    sh = 1;
    sw = boxAspect / mediaAspect;
    sx = (1 - sw) / 2;
    sy = 0;
  } else {
    sw = 1;
    sh = mediaAspect / boxAspect;
    sx = 0;
    sy = (1 - sh) / 2;
  }

  return {
    x: sx + nx * sw,
    y: sy + ny * sh,
  };
}
