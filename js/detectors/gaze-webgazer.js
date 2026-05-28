import { clientPointToVideoFrame } from "../gaze-viewport.js";
import {
  gazeFromPoint,
  gazeZoneLabel,
  resetGazeSmoothing,
  screenZone,
} from "./gaze.js";
import { gazePrefKey } from "../gesture-preferences.js";

const WEBGAZER_CDN =
  "https://cdn.jsdelivr.net/npm/webgazer@3.4.0/dist/webgazer.js";

const GAZE_ZONE_COOLDOWN_MS = 1100;
const MIN_SAMPLES_FOR_EVENTS = 8;
const SMOOTHING = 0.28;

/** @type {Promise<void> | null} */
let scriptLoadPromise = null;

/**
 * @returns {Promise<typeof webgazer>}
 */
export function loadWebGazerScript() {
  if (globalThis.webgazer) {
    return Promise.resolve(globalThis.webgazer);
  }
  if (!scriptLoadPromise) {
    scriptLoadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-camtrol-webgazer="1"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(globalThis.webgazer));
        existing.addEventListener("error", () => reject(new Error("WebGazer script failed")));
        return;
      }
      const script = document.createElement("script");
      script.src = WEBGAZER_CDN;
      script.async = true;
      script.dataset.camtrolWebgazer = "1";
      script.onload = () => {
        if (!globalThis.webgazer) {
          reject(new Error("WebGazer did not attach to window"));
          return;
        }
        resolve(globalThis.webgazer);
      };
      script.onerror = () => reject(new Error("Could not load WebGazer from CDN"));
      document.head.appendChild(script);
    });
  }
  return scriptLoadPromise.then(() => globalThis.webgazer);
}

/**
 * @param {{ onEvent: (e: { label: string, detail?: string }) => void, onStatus?: (detail: string) => void, isGestureEnabled?: (id: string) => boolean, getMirrorDisplay?: () => boolean }} options
 */
export function createWebGazerGaze(options) {
  /** @type {ReturnType<typeof gazeFromPoint> & { onPreview?: boolean } | null} */
  let lastGaze = null;
  /** @type {{ x: number, y: number } | null} */
  let smoothedPoint = null;
  let lastZone = null;
  let lastEmit = 0;
  let sampleCount = 0;
  let running = false;
  /** @type {MediaStream | null} */
  let boundStream = null;

  function reset() {
    resetGazeSmoothing();
    smoothedPoint = null;
    lastGaze = null;
    lastZone = null;
    lastEmit = 0;
    sampleCount = 0;
  }

  /**
   * @param {{ x: number, y: number } | null} data
   * @param {HTMLVideoElement} video
   */
  function ingestPrediction(data, video) {
    if (!data || !running) return;

    const frameWidth = video.videoWidth || 640;
    const frameHeight = video.videoHeight || 480;
    const mapped = clientPointToVideoFrame(video, data.x, data.y, {
      mirrorDisplay: options.getMirrorDisplay?.() ?? false,
    });
    if (!mapped) return;

    sampleCount += 1;

    if (!smoothedPoint) {
      smoothedPoint = { x: mapped.x, y: mapped.y };
    } else {
      smoothedPoint = {
        x: smoothedPoint.x * (1 - SMOOTHING) + mapped.x * SMOOTHING,
        y: smoothedPoint.y * (1 - SMOOTHING) + mapped.y * SMOOTHING,
      };
    }

    const point = { x: smoothedPoint.x, y: smoothedPoint.y };
    const zone = screenZone(point.x, point.y, frameWidth, frameHeight);
    const confidence = Math.min(1, 0.35 + sampleCount / 40);

    lastGaze = {
      ...gazeFromPoint(point, frameWidth, frameHeight),
      zone,
      confidence,
      source: "webgazer",
      onPreview: mapped.onPreview,
    };

    const gazeKey = gazePrefKey(zone.id);
    const now = Date.now();
    if (
      sampleCount >= MIN_SAMPLES_FOR_EVENTS &&
      (!options.isGestureEnabled || options.isGestureEnabled(gazeKey)) &&
      zone.id !== lastZone &&
      now - lastEmit > GAZE_ZONE_COOLDOWN_MS
    ) {
      lastZone = zone.id;
      lastEmit = now;
      options.onEvent({
        label: gazeZoneLabel(zone.id),
        detail: `${zone.label} · WebGazer · (${Math.round(point.x)}, ${Math.round(point.y)})`,
      });
    }
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {MediaStream} stream
   */
  async function start(video, stream) {
    const wg = await loadWebGazerScript();
    reset();
    boundStream = stream;

    wg.showVideoPreview(false)
      .showVideo(false)
      .showFaceOverlay(false)
      .showFaceFeedbackBox(false)
      .showPredictionPoints(false)
      .saveDataAcrossSessions(true)
      .applyKalmanFilter(true);

    await new Promise((resolve, reject) => {
      wg.setGazeListener((data) => {
        ingestPrediction(data, video);
      });
      wg.begin()
        .then(() => resolve(undefined))
        .catch(reject);
    });

    const wgVideo = document.getElementById("webgazerVideoFeed");
    if (wgVideo && stream) {
      const previous = /** @type {HTMLVideoElement} */ (wgVideo).srcObject;
      /** @type {HTMLVideoElement} */ (wgVideo).srcObject = stream;
      if (previous && previous !== stream && "getTracks" in previous) {
        for (const track of previous.getTracks()) {
          if (!stream.getTracks().some((t) => t.id === track.id)) {
            track.stop();
          }
        }
      }
      try {
        await /** @type {HTMLVideoElement} */ (wgVideo).play();
      } catch {
        /* autoplay may already be running */
      }
    }

    const canvas = wg.getVideoElementCanvas?.();
    if (canvas && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    running = true;
    options.onStatus?.(
      "WebGazer active — click and move the mouse on the page to calibrate gaze",
    );
  }

  /**
   * @param {HTMLVideoElement} video
   */
  function tick(video) {
    if (!running || !globalThis.webgazer) return lastGaze;

    const canvas = globalThis.webgazer.getVideoElementCanvas?.();
    if (canvas && video.videoWidth && video.readyState >= 2) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    const prediction = globalThis.webgazer.getCurrentPrediction?.();
    if (prediction) {
      ingestPrediction(prediction, video);
    }

    return lastGaze;
  }

  function stop() {
    running = false;
    if (globalThis.webgazer) {
      globalThis.webgazer.clearGazeListener?.();
      globalThis.webgazer.pause?.();
    }
    reset();
    boundStream = null;
  }

  async function dispose() {
    stop();
    if (globalThis.webgazer?.end) {
      try {
        globalThis.webgazer.end();
      } catch {
        /* ignore */
      }
    }
  }

  return { start, tick, stop, dispose, reset, getLastGaze: () => lastGaze };
}
