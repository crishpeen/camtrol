const BUFFER_SIZE = 6;
const MIN_AGREEMENT = 0.55;
const MIN_CONFIDENCE = 0.5;

/**
 * Temporal smoothing: require a gesture to win a majority of recent frames.
 */
export function createGestureStabilizer() {
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
      state = { buffer: new Array(BUFFER_SIZE).fill(null), index: 0 };
      hands.set(handKey, state);
    }

    state.buffer[state.index] = gesture;
    state.index = (state.index + 1) % BUFFER_SIZE;

    return pickStable(state.buffer);
  }

  /**
   * @param {({ id: string, confidence: number } | null)[]} buffer
   */
  function pickStable(buffer) {
    const filled = buffer.filter(Boolean);
    if (filled.length < 3) return null;

    /** @type {Map<string, { count: number, confidenceSum: number }>} */
    const votes = new Map();

    for (const g of filled) {
      if (!g || g.confidence < MIN_CONFIDENCE) continue;
      const prev = votes.get(g.id) ?? { count: 0, confidenceSum: 0 };
      prev.count += 1;
      prev.confidenceSum += g.confidence;
      votes.set(g.id, prev);
    }

    let bestId = null;
    let bestScore = 0;

    for (const [id, { count, confidenceSum }] of votes) {
      const agreement = count / filled.length;
      if (agreement < MIN_AGREEMENT) continue;
      const avgConf = confidenceSum / count;
      const combined = agreement * 0.6 + avgConf * 0.4;
      if (combined > bestScore) {
        bestScore = combined;
        bestId = id;
      }
    }

    if (!bestId) return null;
    const winner = votes.get(bestId);
    return {
      id: bestId,
      confidence: bestScore,
    };
  }

  return { push, reset };
}
