/**
 * Leave copies out of the persisted agent state blob, and put them back on load.
 *
 * The blob is rewritten at every step, so every byte in it is paid for once per
 * step on the write and again on the next step's read. Three parts of it are
 * exact copies of data the operation already holds elsewhere:
 *
 * - `initialContext.payload.tools` is the same array as `operationToolSet.tools`
 *   (`operationPrep` hands both the discovery result);
 * - each `activatedStepTools[i].manifest` is copied from
 *   `operationToolSet.manifestMap[id]` when the tool is activated;
 * - the deprecated top-level `expertise` mirrors `world.expertise`.
 *
 * {@link slimStateForPersist} drops a copy only when it is equal to its source,
 * and records what it dropped under {@link SLIM_MARKER_KEY};
 * {@link restoreSlimState} reads that record and rebuilds exactly those fields,
 * so the state a reader sees after load is the same as before the save. A copy
 * that differs from its source stays inline. The source must already be on the
 * state: restore runs after the tool set is re-attached.
 */

/** Persist-only record of the copies left out. Never present on a live state. */
export const SLIM_MARKER_KEY = '__slim';

interface SlimMarker {
  /** Indices into `activatedStepTools` whose `manifest` was left out. */
  activatedManifests?: number[];
  /** The top-level `expertise` was left out. */
  expertise?: true;
  /** `initialContext.payload.tools` was left out. */
  payloadTools?: true;
}

type LooseState = Record<string, any>;

const sameJson = (a: unknown, b: unknown) =>
  a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);

/**
 * Return a shallow copy of `state` without the copies listed above, plus the
 * marker. Objects along a changed path are cloned; `state` is never mutated.
 * Returns `state` itself when nothing was left out.
 */
export const slimStateForPersist = <T extends object>(state: T): T => {
  const source = state as LooseState;
  const toolSet = source.operationToolSet;
  const marker: SlimMarker = {};
  const next: LooseState = { ...source };

  const payload = source.initialContext?.payload;
  if (payload && sameJson(payload.tools, toolSet?.tools)) {
    const { tools: _tools, ...payloadRest } = payload;
    next.initialContext = { ...source.initialContext, payload: payloadRest };
    marker.payloadTools = true;
  }

  const activated = source.activatedStepTools;
  if (Array.isArray(activated) && toolSet?.manifestMap) {
    const indices: number[] = [];
    const slimmed = activated.map((entry: LooseState, index: number) => {
      if (!entry?.manifest || !sameJson(entry.manifest, toolSet.manifestMap[entry.id])) {
        return entry;
      }
      indices.push(index);
      const { manifest: _manifest, ...rest } = entry;
      return rest;
    });
    if (indices.length > 0) {
      next.activatedStepTools = slimmed;
      marker.activatedManifests = indices;
    }
  }

  if (source.expertise !== undefined && sameJson(source.expertise, source.world?.expertise)) {
    delete next.expertise;
    marker.expertise = true;
  }

  if (Object.keys(marker).length === 0) return state;
  next[SLIM_MARKER_KEY] = marker;
  return next as T;
};

/**
 * Rebuild the fields {@link slimStateForPersist} left out, in place, and drop
 * the marker. Each restored value is a fresh copy, as a JSON parse of the full
 * blob would have produced, so mutating it never reaches its source. A field
 * whose source is gone (the tool set key expired) stays absent — the same
 * fallback a missing tool set already gets.
 */
export const restoreSlimState = (state: object): void => {
  const target = state as LooseState;
  const marker = target[SLIM_MARKER_KEY] as SlimMarker | undefined;
  if (!marker) return;
  delete target[SLIM_MARKER_KEY];

  const toolSet = target.operationToolSet;

  if (marker.payloadTools && target.initialContext?.payload && toolSet?.tools) {
    target.initialContext.payload.tools = structuredClone(toolSet.tools);
  }

  if (marker.activatedManifests && Array.isArray(target.activatedStepTools)) {
    for (const index of marker.activatedManifests) {
      const entry = target.activatedStepTools[index];
      const manifest = entry && toolSet?.manifestMap?.[entry.id];
      if (manifest) entry.manifest = structuredClone(manifest);
    }
  }

  if (marker.expertise && target.world?.expertise !== undefined) {
    target.expertise = structuredClone(target.world.expertise);
  }
};
