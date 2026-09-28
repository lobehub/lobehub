import { describe, expect, it } from 'vitest';

import { mergeJsonPatch } from './json-patch';

describe('mergeJsonPatch', () => {
  it('keeps stored keys the request never mentioned', () => {
    // The whole point: `agencyConfig` carries permission policies the public
    // schema cannot express, and an unrelated graph edit must not delete them.
    const merged = mergeJsonPatch(
      { boundDeviceId: 'device-1', modelSelectionPolicy: 'fixed', topicSharePolicy: 'restricted' },
      { graph: { nodes: [] } },
    );

    expect(merged).toEqual({
      boundDeviceId: 'device-1',
      graph: { nodes: [] },
      modelSelectionPolicy: 'fixed',
      topicSharePolicy: 'restricted',
    });
  });

  it('overwrites the keys the request does mention', () => {
    expect(mergeJsonPatch({ enableGraphMode: false, other: 1 }, { enableGraphMode: true })).toEqual(
      {
        enableGraphMode: true,
        other: 1,
      },
    );
  });

  it('keeps an explicit null, which the schemas use as "cleared"', () => {
    expect(mergeJsonPatch({ graph: { nodes: [] } }, { graph: null })).toEqual({ graph: null });
  });

  it('removes a key set to undefined', () => {
    expect(mergeJsonPatch({ graph: { nodes: [] }, keep: 1 }, { graph: undefined })).toEqual({
      keep: 1,
    });
  });

  // Clearing a whole column is the caller's decision, not this helper's:
  // `agent.service` maps an explicit `agencyConfig: null` to `null` before
  // ever reaching here, while `params` has always treated it as a no-op.
  it('leaves the stored object untouched when there is nothing to apply', () => {
    const existing = { topicSharePolicy: 'restricted' };

    expect(mergeJsonPatch(existing, null)).toEqual(existing);
    expect(mergeJsonPatch(existing, undefined)).toEqual(existing);
  });

  it('starts from an empty object when nothing is stored yet', () => {
    expect(mergeJsonPatch(null, { enableGraphMode: true })).toEqual({ enableGraphMode: true });
  });

  it('does not mutate the stored object', () => {
    const existing = { topicSharePolicy: 'restricted' };
    mergeJsonPatch(existing, { enableGraphMode: true });

    expect(existing).toEqual({ topicSharePolicy: 'restricted' });
  });
});
