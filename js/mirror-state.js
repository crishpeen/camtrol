/** Shared mirror flag: CSS preview + ML flipHorizontal must stay in sync. */

let mirrorPreview = false;

export function isMirrorPreview() {
  return mirrorPreview;
}

/** @param {boolean} on */
export function setMirrorPreview(on) {
  mirrorPreview = on;
}

/** ML detectors use the same flag as the mirrored CSS preview. */
export function flipHorizontalForMl() {
  return mirrorPreview;
}
