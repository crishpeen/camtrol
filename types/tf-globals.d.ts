export {};

declare global {
  const tf: typeof import("@tensorflow/tfjs");
  /** MediaPipe Hands peer (loaded from CDN on mobile). */
  const Hands: unknown;
  const handPoseDetection: typeof import("@tensorflow-models/hand-pose-detection");
  const poseDetection: typeof import("@tensorflow-models/pose-detection");
  const faceLandmarksDetection: typeof import("@tensorflow-models/face-landmarks-detection");
  /** Loaded on demand when gaze engine is WebGazer (GPL-3.0). */
  const webgazer: {
    begin: () => Promise<unknown>;
    end: () => unknown;
    pause: () => unknown;
    clearGazeListener: () => unknown;
    setGazeListener: (fn: (data: { x: number; y: number } | null, elapsed?: number) => void) => unknown;
    getCurrentPrediction: () => { x: number; y: number } | null;
    getVideoElementCanvas: () => HTMLCanvasElement | null;
    showVideoPreview: (v: boolean) => unknown;
    showVideo: (v: boolean) => unknown;
    showFaceOverlay: (v: boolean) => unknown;
    showFaceFeedbackBox: (v: boolean) => unknown;
    showPredictionPoints: (v: boolean) => unknown;
    saveDataAcrossSessions: (v: boolean) => unknown;
    applyKalmanFilter: (v: boolean) => unknown;
  };
}
