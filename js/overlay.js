import { isMirrorPreview } from "./mirror-state.js";

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
];

const POSE_CONNECTIONS = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
];

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLVideoElement} video
 */
export function createOverlay(canvas, video) {
  const ctx = canvas.getContext("2d");

  function resize() {
    const w = video.videoWidth || video.clientWidth;
    const h = video.videoHeight || video.clientHeight;
    if (w && h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  const FACE_DRAW_INDICES = [
    10, 33, 61, 133, 145, 159, 263, 291, 334, 362, 374, 386, 1, 13, 14, 152,
  ];

  /**
   * @param {{ keypoints: { x: number, y: number, name?: string, score?: number }[] }[]} hands
   * @param {{ keypoints: { x: number, y: number, name?: string, score?: number }[] }[]} poses
   * @param {{ keypoints?: { x: number, y: number }[], scaledMesh?: { x: number, y: number }[] }[]} faces
   */
  /**
   * Landmarks may be normalized (0–1) or pixel coords depending on runtime.
   * @param {{ x: number, y: number }} p
   */
  function toCanvasPoint(p) {
    const w = canvas.width || 1;
    const h = canvas.height || 1;
    let x;
    let y;
    if (p.x <= 1.5 && p.y <= 1.5 && p.x >= -0.1 && p.y >= -0.1) {
      x = p.x * w;
      y = p.y * h;
    } else {
      x = p.x;
      y = p.y;
    }
    if (isMirrorPreview()) {
      x = w - x;
    }
    return { x, y };
  }

  function draw(hands = [], poses = [], faces = []) {
    resize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const face of faces) {
      const kp = face.keypoints ?? face.scaledMesh;
      drawFace(kp, face.gaze);
    }
    for (const pose of poses) {
      drawPose(pose.keypoints);
    }
    for (const hand of hands) {
      drawHand(hand.keypoints);
    }
  }

  /**
   * @param {{ x: number, y: number }[] | undefined} keypoints
   * @param {{ point: { x: number, y: number }, zone: { label: string }, eyes: object } | null | undefined} [gaze]
   */
  function drawFace(keypoints, gaze) {
    if (!keypoints?.length) return;

    ctx.strokeStyle = "rgba(251, 191, 36, 0.75)";
    ctx.fillStyle = "rgba(251, 191, 36, 0.85)";
    ctx.lineWidth = 1.5;

    const lip = [61, 291, 13, 14];
    ctx.beginPath();
    for (const i of lip) {
      const raw = keypoints[i];
      if (!raw) continue;
      const p = toCanvasPoint(raw);
      if (i === lip[0]) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    for (const i of FACE_DRAW_INDICES) {
      const raw = keypoints[i];
      if (!raw) continue;
      const p = toCanvasPoint(raw);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (gaze?.eyes) {
      drawEyeGaze(gaze);
    }
  }

  /** @param {{ point: { x: number, y: number }, zone: { label: string }, eyes: { left: object, right: object } }} gaze */
  function drawEyeGaze(gaze) {
    const w = canvas.width;
    const h = canvas.height;

    drawGazeGrid(w, h);

    const left = gaze.eyes.left;
    const right = gaze.eyes.right;
    const lc = toCanvasPoint(left.center);
    const rc = toCanvasPoint(right.center);
    const li = toCanvasPoint(left.iris);
    const ri = toCanvasPoint(right.iris);
    const gp = toCanvasPoint(gaze.point);

    for (const [center, iris, eye] of [
      [lc, li, left],
      [rc, ri, right],
    ]) {
      ctx.strokeStyle = "rgba(147, 197, 253, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, eye.eyeW * 0.55, eye.eyeH * 0.65, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(96, 165, 250, 1)";
      ctx.beginPath();
      ctx.arc(iris.x, iris.y, Math.max(3, eye.eyeW * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }

    const bridgeX = (lc.x + rc.x) / 2;
    const bridgeY = (lc.y + rc.y) / 2;

    ctx.strokeStyle = "rgba(251, 191, 36, 0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(bridgeX, bridgeY);
    ctx.lineTo(gp.x, gp.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(250, 204, 21, 1)";
    ctx.fillStyle = "rgba(250, 204, 21, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(gp.x, gp.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(gp.x - 18, gp.y);
    ctx.lineTo(gp.x + 18, gp.y);
    ctx.moveTo(gp.x, gp.y - 18);
    ctx.lineTo(gp.x, gp.y + 18);
    ctx.stroke();

    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = "rgba(250, 204, 21, 0.95)";
    ctx.textAlign = "center";
    ctx.fillText(gaze.zone.label, gp.x, Math.max(14, gp.y - 22));
  }

  function drawGazeGrid(w, h) {
    ctx.strokeStyle = "rgba(251, 191, 36, 0.12)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const x = (w * i) / 3;
      const y = (h * i) / 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * @param {{ x: number, y: number, score?: number }[]} keypoints
   */
  function drawHand(keypoints) {
    if (!keypoints?.length) return;

    ctx.strokeStyle = "rgba(52, 211, 153, 0.95)";
    ctx.lineWidth = 3;
    ctx.fillStyle = "rgba(52, 211, 153, 1)";

    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = toCanvasPoint(keypoints[a]);
      const p2 = toCanvasPoint(keypoints[b]);
      if (!p1 || !p2) continue;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    for (const p of keypoints) {
      const pt = toCanvasPoint(p);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * @param {{ x: number, y: number, name?: string, score?: number }[]} keypoints
   */
  function drawPose(keypoints) {
    if (!keypoints?.length) return;

    const byName = Object.fromEntries(keypoints.map((k) => [k.name, k]));

    ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(56, 189, 248, 0.9)";

    for (const [a, b] of POSE_CONNECTIONS) {
      const p1 = byName[a];
      const p2 = byName[b];
      if (!p1 || !p2 || (p1.score ?? 1) < 0.3 || (p2.score ?? 1) < 0.3) continue;
      const c1 = toCanvasPoint(p1);
      const c2 = toCanvasPoint(p2);
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.stroke();
    }

    for (const kp of keypoints) {
      if ((kp.score ?? 1) < 0.3) continue;
      const p = toCanvasPoint(kp);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { draw, clear, resize };
}
