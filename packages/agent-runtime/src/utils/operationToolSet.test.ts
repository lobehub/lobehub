import { describe, expect, it } from 'vitest';

import { selectEffectiveToolManifestMap } from './operationToolSet';

const shellManifest = { api: [{ name: 'runCommand' }], identifier: 'lobe-skills' };
const fullManifest = {
  api: [{ name: 'runCommand' }, { humanIntervention: 'required', name: 'execScript' }],
  identifier: 'lobe-skills',
};
const searchManifest = { api: [{ name: 'search' }], identifier: 'web-search' };

const toolSet = (extra: object = {}) =>
  ({
    enabledToolIds: ['lobe-skills'],
    manifestMap: { 'lobe-skills': shellManifest },
    sourceMap: {},
    tools: [],
    ...extra,
  }) as any;

describe('selectEffectiveToolManifestMap', () => {
  it('returns the static map itself when nothing is activated or deferred', () => {
    const operationToolSet = toolSet();

    expect(selectEffectiveToolManifestMap({ operationToolSet })).toBe(operationToolSet.manifestMap);
  });

  // A call to an API the run has not been offered yet must still find that
  // API's approval rule, not a narrowed manifest that does not list it.
  it('resolves a deferred tool to its full manifest before it is promoted', () => {
    const map = selectEffectiveToolManifestMap({
      operationToolSet: toolSet({ deferredManifestMap: { 'lobe-skills': fullManifest } }),
    });

    expect(map['lobe-skills']).toBe(fullManifest);
  });

  it('lets a step activation win over the static and deferred manifests', () => {
    const map = selectEffectiveToolManifestMap({
      activatedStepTools: [
        { activatedAtStep: 1, id: 'web-search', manifest: searchManifest, source: 'discovery' },
      ] as any,
      operationToolSet: toolSet({ deferredManifestMap: { 'lobe-skills': fullManifest } }),
    });

    expect(map).toEqual({ 'lobe-skills': fullManifest, 'web-search': searchManifest });
  });
});
