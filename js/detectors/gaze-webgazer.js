import { buildVideoConstraints } from "../camera.js";
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
const MIN_SAMPLES_FOR_EVENTS = 4;
const SMOOTHING = 0.28;

/** @type {Promise<typeof webgazer> | null} */
let scriptLoadPromise = null;

function isMobile() {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(max-width: 900px), (pointer: coarse)").matches
  );
}

/**
 * @returns {Promise<typeof webgazer>}
 */
export function loadWebGazerScript() {
  if (globalThis.webgazer) {
    return Promise.resolve(globalThis.webgazer);
  }
  if (!scriptLoadPromise) {
    const savedTf = globalThis.tf;
    scriptLoadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-camtrol-webgazer="1"]');
      if (existing) {
        existing.addEventListener("load", () => {
          if (savedTf) globalThis.tf = savedTf;
          resolve(globalThis.webgazer);
        });
        existing.addEventListener("error", () => reject(new Error("WebGazer script failed")));
        return;
      }
      const script = document.createElement("script");
      script.src = WEBGAZER_CDN;
      script.async = true;
      script.dataset.camtrolWebgazer = "1";
      script.onload = () => {
        if (savedTf) globalThis.tf = savedTf;
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
  return scriptLoadPromise;
}

/**
 * @param {HTMLVideoElement} el
 */
function waitForVideoDimensions(el) {
  return new Promise((resolve) => {
    if (el.videoWidth > 0) {
      resolve();
      return;
    }
    const done = () => {
      el.removeEventListener("loadeddata", done);
      el.removeEventListener("resize", done);
      resolve();
    };
    el.addEventListener("loadeddata", done);
    el.addEventListener("resize", done);
    window.setTimeout(done, 4000);
  });
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
  let calibrationTouches = 0;
  let running = false;
  /** @type {MediaStream | null} */
  let boundStream = null;
  /** @type {HTMLCanvasElement | null} */
  let feedCanvas = null;
  /** @type {(() => void) | null} */
  let removeTouchCalibration = null;

  function reset() {
    resetGazeSmoothing();
    smoothedPoint = null;
    lastGaze = null;
    lastZone = null;
    lastEmit = 0;
    sampleCount = 0;
    calibrationTouches = 0;
  }

  /**
   * @param {{ x: number, y: number } | null} data
   * @param {HTMLVideoElement} video
   */
  function ingestPrediction(data, video) {
    if (!data || data.x == null || data.y == null) return;

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
    const confidence = Math.min(1, 0.35 + sampleCount / 30);

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
   * @param {typeof webgazer} wg
   */
  function installTouchCalibration(wg) {
    const record = (clientX, clientY, eventType) => {
      calibrationTouches += 1;
      wg.recordScreenPosition?.(clientX, clientY, eventType);
    };

    const onPointerDown = (e) => {
      if (!running) return;
      record(e.clientX, e.clientY, "click");
    };

    const onPointerMove = (e) => {
      if (!running || e.buttons === 0) return;
      record(e.clientX, e.clientY, "move");
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
    };
  }

  /**
   * @param {typeof webgazer} wg
   * @param {HTMLVideoElement} video
   */
  async function configureWebGazer(wg, video) {
    wg.showVideoPreview(false)
      .showVideo(false)
      .showFaceOverlay(false)
      .showFaceFeedbackBox(false)
      .showPredictionPoints(false)
      .saveDataAcrossSessions(true)
      .applyKalmanFilter(true);

    if (typeof wg.setRegression === "function") {
      wg.setRegression("ridge");
    }

    running = true;

    await new Promise((resolve, reject) => {
      wg.setGazeListener((data) => {
        ingestPrediction(data, video);
      });
      wg.begin().then(() => resolve(undefined)).catch(reject);
    });

    const wgVideo = /** @type {HTMLVideoElement | null} */ (
      document.getElementById("webgazerVideoFeed")
    );
    if (!wgVideo?.srcObject) {
      throw new Error("WebGazer did not open a camera stream");
    }

    await waitForVideoDimensions(wgVideo);

    if (video.videoWidth === 0) {
      video.srcObject = wgVideo.srcObject;
      await video.play().catch(() => {});
      await waitForVideoDimensions(video);
    }

    const w = video.videoWidth || wgVideo.videoWidth;
    const h = video.videoHeight || wgVideo.videoHeight;
    if (w && h && typeof wg.setInternalVideoBufferSizes === "function") {
      wg.setInternalVideoBufferSizes(w, h);
    }

    feedCanvas = document.createElement("canvas");
    feedCanvas.width = w || 640;
    feedCanvas.height = h || 480;
    wg.setVideoElementCanvas?.(feedCanvas);

    removeTouchCalibration = installTouchCalibration(wg);
    wg.addMouseEventListeners?.();

    if (typeof wg.resume === "function") {
      await wg.resume();
    }

    const mobile = isMobile();
    options.onStatus?.(
      mobile
        ? "WebGazer on — keep your face in the preview, then tap around the page while looking where you tap"
        : "WebGazer on — click and move the mouse while looking at the cursor to calibrate",
    );
  }

  /**
   * Open the camera once through WebGazer (required on phones — no second getUserMedia).
   * @param {{ deviceId?: string, facingMode?: string }} choice
   * @param {HTMLVideoElement} video
   * @returns {Promise<MediaStream>}
   */
  async function acquireCameraStream(choice, video) {
    const wg = await loadWebGazerScript();
    reset();

    wg.setCameraConstraints?.({
      video: buildVideoConstraints(choice),
      audio: false,
    });

    await configureWebGazer(wg, video);

    const wgVideo = /** @type {HTMLVideoElement} */ (
      document.getElementById("webgazerVideoFeed")
    );
    const acquired = /** @type {MediaStream} */ (wgVideo.srcObject);
    boundStream = acquired;
    return acquired;
  }

  /**
   * @param {HTMLVideoElement} video
   */
  async function tick(video) {
    if (!running || !globalThis.webgazer) return lastGaze;

    if (feedCanvas && video.videoWidth && video.readyState >= 2) {
      if (feedCanvas.width !== video.videoWidth || feedCanvas.height !== video.videoHeight) {
        feedCanvas.width = video.videoWidth;
        feedCanvas.height = video.videoHeight;
        globalThis.webgazer.setInternalVideoBufferSizes?.(
          video.videoWidth,
          video.videoHeight,
        );
      }
      const ctx = feedCanvas.getContext("2d", { willReadFrequently: true });
      ctx?.drawImage(video, 0, 0, feedCanvas.width, feedCanvas.height);
    }

    try {
      const prediction = await globalThis.webgazer.getCurrentPrediction?.();
      ingestPrediction(prediction, video);
    } catch {
      /* prediction may fail until face is visible */
    }

    return lastGaze;
  }

  function stop() {
    running = false;
    removeTouchCalibration?.();
    removeTouchCalibration = null;
    if (globalThis.webgazer) {
      globalThis.webgazer.removeMouseEventListeners?.();
      globalThis.webgazer.clearGazeListener?.();
      globalThis.webgazer.pause?.();
    }
    reset();
    boundStream = null;
    feedCanvas = null;
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

  function getStatusDetail() {
    if (!running) return "WebGazer starting…";
    if (lastGaze) return `Gaze tracking · ${lastGaze.zone.label}`;
    if (calibrationTouches < 3) {
      return isMobile()
        ? "Calibrating — tap the page while looking where you tap"
        : "Calibrating — click around while looking at the cursor";
    }
    return "Face the camera — waiting for gaze prediction";
  }

  return {
    acquireCameraStream,
    tick,
    stop,
    dispose,
    reset,
    getLastGaze: () => lastGaze,
    getStatusDetail,
  };
}
