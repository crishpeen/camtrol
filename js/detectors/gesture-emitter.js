/**
 * Emit a pose gesture only after it is stable and distinct from the last emission.
 */
export function createGestureEmitter({
  minStableFrames = 7,
  minConfidence = 0.68,
} = {}) {
  /** @type {Map<string, { tail: string[], lastEmitted: string | null, lastEmitAt: number }>} */
  const hands = new Map();

  function reset() {
    hands.clear();
  }

  /**
   * @param {string} handKey
   * @param {{ id: string, confidence: number } | null} gesture
   * @returns {{ id: string, confidence: number } | null}
   */
  function consider(handKey, gesture) {
    let state = hands.get(handKey);
    if (!state) {
      state = { tail: [], lastEmitted: null, lastEmitAt: 0 };
      hands.set(handKey, state);
    }

    if (!gesture || gesture.confidence < minConfidence) {
      state.tail.push("");
      if (state.tail.length > 12) state.tail.shift();
      return null;
    }

    state.tail.push(gesture.id);
    if (state.tail.length > 12) state.tail.shift();

    const recent = state.tail.filter(Boolean);
    const same = recent.filter((id) => id === gesture.id).length;
    if (same < minStableFrames) return null;

    if (gesture.id === state.lastEmitted) return null;

    state.lastEmitted = gesture.id;
    state.lastEmitAt = Date.now();
    return gesture;
  }

  /**
   * Allow re-emitting the same gesture after the hand left frame or pose was cleared.
   * @param {string} handKey
   */
  function unlock(handKey) {
    const state = hands.get(handKey);
    if (state) {
      state.lastEmitted = null;
      state.tail = [];
    }
  }

  return { consider, unlock, reset };
}
