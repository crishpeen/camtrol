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
  function draw(hands = [], poses = [], faces = []) {
    resize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const face of faces) {
      drawFace(face.keypoints ?? face.scaledMesh);
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
   */
  function drawFace(keypoints) {
    if (!keypoints?.length) return;

    ctx.strokeStyle = "rgba(251, 191, 36, 0.75)";
    ctx.fillStyle = "rgba(251, 191, 36, 0.85)";
    ctx.lineWidth = 1.5;

    const lip = [61, 291, 13, 14];
    ctx.beginPath();
    for (const i of lip) {
      const p = keypoints[i];
      if (!p) continue;
      if (i === lip[0]) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    for (const i of FACE_DRAW_INDICES) {
      const p = keypoints[i];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
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

    ctx.strokeStyle = "rgba(52, 211, 153, 0.85)";
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(52, 211, 153, 0.9)";

    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = keypoints[a];
      const p2 = keypoints[b];
      if (!p1 || !p2) continue;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    for (const p of keypoints) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
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
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    for (const kp of keypoints) {
      if ((kp.score ?? 1) < 0.3) continue;
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { draw, clear, resize };
}
