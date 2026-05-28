const MEDIAPIPE_HANDS_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js";

/**
 * Ensure @mediapipe/hands is on window (module scripts can run before sync scripts finish).
 * @returns {Promise<boolean>}
 */
export function ensureMediapipeHandsScript() {
  if (globalThis.Hands) return Promise.resolve(true);

  const existing = document.querySelector('script[data-camtrol="mediapipe-hands"]');
  if (existing) {
    return new Promise((resolve) => {
      if (globalThis.Hands) {
        resolve(true);
        return;
      }
      existing.addEventListener("load", () => resolve(!!globalThis.Hands), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      setTimeout(() => resolve(!!globalThis.Hands), 2500);
    });
  }

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = MEDIAPIPE_HANDS_URL;
    script.crossOrigin = "anonymous";
    script.dataset.camtrol = "mediapipe-hands";
    script.onload = () => resolve(!!globalThis.Hands);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}
