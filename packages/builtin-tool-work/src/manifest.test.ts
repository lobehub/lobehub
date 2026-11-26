import { describe, expect, it } from 'vitest';

import { WorkManifest } from './manifest';
import { WorkApiName, WorkIdentifier } from './types';

describe('work tool manifest', () => {
  it('declares every API once, under the stable identifier', () => {
    expect(WorkManifest.identifier).toBe('lobe-work');
    expect(WorkIdentifier).toBe('lobe-work');
    expect(WorkManifest.api.map((entry) => entry.name).sort()).toEqual(
      Object.values(WorkApiName).sort(),
    );
  });

  it('runs without asking, including delete', () => {
    for (const entry of WorkManifest.api) expect(entry.humanIntervention, entry.name).toBe('never');
  });

  it('never takes the run from the model', () => {
    for (const entry of WorkManifest.api) {
      const properties = Object.keys(entry.parameters.properties ?? {});
      for (const forbidden of ['operationId', 'topicId', 'threadId', 'agentId', 'userId'])
        expect(properties).not.toContain(forbidden);
    }
  });
});
