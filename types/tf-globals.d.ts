export {};

declare global {
  const tf: typeof import("@tensorflow/tfjs");
  /** MediaPipe Hands peer (loaded from CDN on mobile). */
  const Hands: unknown;
  const handPoseDetection: typeof import("@tensorflow-models/hand-pose-detection");
  const poseDetection: typeof import("@tensorflow-models/pose-detection");
  const faceLandmarksDetection: typeof import("@tensorflow-models/face-landmarks-detection");
}
