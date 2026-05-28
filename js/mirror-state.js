/** Mirror only affects video CSS + overlay X flip (ML always uses raw camera coords). */

let mirrorPreview = false;

export function isMirrorPreview() {
  return mirrorPreview;
}

/** @param {boolean} on */
export function setMirrorPreview(on) {
  mirrorPreview = on;
}
