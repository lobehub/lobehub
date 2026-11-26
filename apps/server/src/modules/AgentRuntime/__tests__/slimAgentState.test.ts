import { describe, expect, it } from 'vitest';

import { restoreSlimState, SLIM_MARKER_KEY, slimStateForPersist } from '../slimAgentState';

const manifestA = { api: [{ name: 'a' }], identifier: 'a' };
const manifestB = { api: [{ name: 'b' }], identifier: 'b' };
const toolSet = {
  enabledToolIds: ['a', 'b'],
  manifestMap: { a: manifestA, b: manifestB },
  sourceMap: {},
  tools: [{ function: { name: 'a' } }, { function: { name: 'b' } }],
};
const expertise = { renderedContext: 'expert', version: 1 };

const buildState = () => ({
  activatedStepTools: [
    { activatedAtStep: 1, id: 'a', manifest: structuredClone(manifestA), source: 'discovery' },
    { activatedAtStep: 2, id: 'c', manifest: { api: [], identifier: 'c' }, source: 'discovery' },
    { activatedAtStep: 3, id: 'b', source: 'discovery' },
  ],
  expertise: structuredClone(expertise),
  initialContext: {
    payload: { message: [{ content: 'hi' }], tools: structuredClone(toolSet.tools) },
    phase: 'user_input',
  },
  operationToolSet: toolSet,
  status: 'running',
  world: { expertise: structuredClone(expertise) },
});

/** What the persistence layer does: JSON round-trip, then restore. */
const roundTrip = (state: object) => {
  const loaded = JSON.parse(JSON.stringify(slimStateForPersist(state)));
  restoreSlimState(loaded);
  return loaded;
};

describe('slimStateForPersist', () => {
  it('drops the copies equal to their source and records them', () => {
    const slim = slimStateForPersist(buildState()) as any;

    expect(slim.initialContext.payload.tools).toBeUndefined();
    expect(slim.initialContext.payload.message).toEqual([{ content: 'hi' }]);
    expect(slim.activatedStepTools[0]).toEqual({
      activatedAtStep: 1,
      id: 'a',
      source: 'discovery',
    });
    // Not in the manifest map: stays inline.
    expect(slim.activatedStepTools[1].manifest).toEqual({ api: [], identifier: 'c' });
    expect(slim.expertise).toBeUndefined();
    expect(slim[SLIM_MARKER_KEY]).toEqual({
      activatedManifests: [0],
      expertise: true,
      payloadTools: true,
    });
  });

  it('never mutates the live state', () => {
    const state = buildState();
    const before = JSON.stringify(state);

    slimStateForPersist(state);

    expect(JSON.stringify(state)).toBe(before);
  });

  it('keeps a copy that differs from its source', () => {
    const state = buildState();
    state.initialContext.payload.tools = [{ function: { name: 'other' } }];
    state.expertise = { renderedContext: 'stale', version: 0 };
    state.activatedStepTools[0].manifest = { api: [], identifier: 'a-old' } as any;

    const slim = slimStateForPersist(state) as any;

    expect(slim.initialContext.payload.tools).toEqual([{ function: { name: 'other' } }]);
    expect(slim.expertise).toEqual({ renderedContext: 'stale', version: 0 });
    expect(slim.activatedStepTools[0].manifest).toEqual({ api: [], identifier: 'a-old' });
    expect(slim[SLIM_MARKER_KEY]).toBeUndefined();
  });

  it('returns the state itself when there is nothing to drop', () => {
    const state = { status: 'running', stepCount: 1 };

    expect(slimStateForPersist(state)).toBe(state);
  });

  it('keeps everything without a tool set to restore from', () => {
    const { operationToolSet: _toolSet, ...state } = buildState();

    const slim = slimStateForPersist(state) as any;

    expect(slim.initialContext.payload.tools).toHaveLength(2);
    expect(slim.activatedStepTools[0].manifest).toEqual(manifestA);
    // Expertise has its own source (`world.expertise`).
    expect(slim[SLIM_MARKER_KEY]).toEqual({ expertise: true });
  });
});

describe('restoreSlimState', () => {
  it('restores the state a reader saw before the save', () => {
    const state = buildState();

    expect(roundTrip(state)).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it('does not add a manifest an entry never had', () => {
    const loaded = roundTrip(buildState());

    expect(loaded.activatedStepTools[2]).toEqual({
      activatedAtStep: 3,
      id: 'b',
      source: 'discovery',
    });
  });

  it('restores fresh copies, not references to their source', () => {
    const loaded = roundTrip(buildState());

    expect(loaded.initialContext.payload.tools).not.toBe(loaded.operationToolSet.tools);
    expect(loaded.activatedStepTools[0].manifest).not.toBe(loaded.operationToolSet.manifestMap.a);
    expect(loaded.expertise).not.toBe(loaded.world.expertise);
  });

  it('leaves a field absent when its source is gone', () => {
    const loaded = JSON.parse(JSON.stringify(slimStateForPersist(buildState())));
    delete loaded.operationToolSet;

    restoreSlimState(loaded);

    expect(loaded.initialContext.payload.tools).toBeUndefined();
    expect(loaded.activatedStepTools[0].manifest).toBeUndefined();
    expect(loaded[SLIM_MARKER_KEY]).toBeUndefined();
  });

  it('is a no-op on a blob saved without slimming', () => {
    const state = JSON.parse(JSON.stringify(buildState()));
    const before = JSON.stringify(state);

    restoreSlimState(state);

    expect(JSON.stringify(state)).toBe(before);
  });

  it('restores a promoted tool from the deferred manifest it was copied from', () => {
    const fullManifest = { api: [{ name: 'a' }, { name: 'a2' }], identifier: 'a' };
    const state = {
      ...buildState(),
      activatedStepTools: [
        {
          activatedAtStep: 1,
          id: 'a',
          manifest: structuredClone(fullManifest),
          source: 'discovery',
        },
      ],
      operationToolSet: { ...toolSet, deferredManifestMap: { a: fullManifest } },
    };

    const slim = slimStateForPersist(state) as any;
    expect(slim.activatedStepTools[0].manifest).toBeUndefined();
    expect(roundTrip(state)).toEqual(state);
  });
});
