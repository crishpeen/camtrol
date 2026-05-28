const DEFAULTS = {
  bufferSize: 10,
  minAgreement: 0.68,
  minConfidence: 0.52,
  minFilled: 5,
};

/**
 * Temporal smoothing: require a gesture to win a majority of recent frames.
 * @param {Partial<typeof DEFAULTS>} [options]
 */
export function createGestureStabilizer(options = {}) {
  const cfg = { ...DEFAULTS, ...options };

  /** @type {Map<string, { buffer: ({ id: string, confidence: number } | null)[], index: number }>} */
  const hands = new Map();

  function reset() {
    hands.clear();
  }

  /**
   * @param {string} handKey
   * @param {{ id: string, confidence: number } | null} gesture
   * @returns {{ id: string, confidence: number } | null}
   */
  function push(handKey, gesture) {
    let state = hands.get(handKey);
    if (!state) {
      state = { buffer: new Array(cfg.bufferSize).fill(null), index: 0 };
      hands.set(handKey, state);
    }

    state.buffer[state.index] = gesture;
    state.index = (state.index + 1) % cfg.bufferSize;

    return pickStable(state.buffer, cfg);
  }

  /**
   * @param {({ id: string, confidence: number } | null)[]} buffer
   * @param {typeof DEFAULTS} cfg
   */
  function pickStable(buffer, cfg) {
    const filled = buffer.filter(Boolean);
    if (filled.length < cfg.minFilled) return null;

    /** @type {Map<string, { count: number, confidenceSum: number }>} */
    const votes = new Map();

    for (const g of filled) {
      if (!g || g.confidence < cfg.minConfidence) continue;
      const prev = votes.get(g.id) ?? { count: 0, confidenceSum: 0 };
      prev.count += 1;
      prev.confidenceSum += g.confidence;
      votes.set(g.id, prev);
    }

    let bestId = null;
    let bestScore = 0;

    for (const [id, { count, confidenceSum }] of votes) {
      const agreement = count / filled.length;
      if (agreement < cfg.minAgreement) continue;
      const avgConf = confidenceSum / count;
      const combined = agreement * 0.65 + avgConf * 0.35;
      if (combined > bestScore) {
        bestScore = combined;
        bestId = id;
      }
    }

    if (!bestId) return null;
    return {
      id: bestId,
      confidence: bestScore,
    };
  }

  return { push, reset };
}

/** Stricter stabilizer for static hand poses (fist, peace, thumbs up, …). */
export function createPoseGestureStabilizer() {
  return createGestureStabilizer({
    bufferSize: 12,
    minAgreement: 0.72,
    minConfidence: 0.5,
    minFilled: 6,
  });
}
