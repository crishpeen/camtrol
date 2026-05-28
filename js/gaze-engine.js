const STORAGE_KEY = "camtrol-gaze-engine-v1";

/** @typedef {"mediapipe" | "webgazer"} GazeEngineId */

/** @returns {GazeEngineId} */
export function getGazeEngine() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "webgazer") return "webgazer";
  } catch {
    /* ignore */
  }
  return "mediapipe";
}

/** @param {GazeEngineId} id */
export function setGazeEngine(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function isWebGazerEngine() {
  return getGazeEngine() === "webgazer";
}
