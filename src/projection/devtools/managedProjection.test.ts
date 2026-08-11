import { describe, expect, it } from 'vitest';

import { projectionStorageKeys } from '../persistence/repository';
import {
  createProjectionFragmentEditRecord,
  inspectManagedProjection,
  parseProjectionFragmentDraft,
} from './managedProjection';

const entry = {
  key: projectionStorageKeys.record('user-1:personal', 'topic', 'topic/1'),
  value: {
    schemaVersion: 1,
    value: {
      fragments: {
        display: { data: { title: 'Initial' }, observedAt: 10, source: 'network' },
      },
      id: 'topic/1',
      kind: 'topic',
    },
  },
};

describe('managed Projections', () => {
  it('recognizes a valid persisted Projection and derives its scoped identity from the key', () => {
    expect(inspectManagedProjection(entry)).toMatchObject({
      projection: {
        record: { id: 'topic/1', kind: 'topic' },
        scope: 'user-1:personal',
      },
      status: 'editable',
    });
  });

  it('rejects envelopes whose storage identity and Projection identity diverge', () => {
    expect(
      inspectManagedProjection({
        ...entry,
        key: projectionStorageKeys.record('user-1:personal', 'topic', 'other-topic'),
      }),
    ).toEqual({
      reason: 'The storage key identity does not match the stored Projection identity.',
      status: 'invalid',
    });
  });

  it('builds a replace-only mutation for an existing fragment', () => {
    const inspection = inspectManagedProjection(entry);
    if (inspection.status !== 'editable') throw new Error(inspection.reason);

    expect(
      createProjectionFragmentEditRecord({
        data: { title: 'Edited' },
        projection: inspection.projection,
        fragmentName: 'display',
        observedAt: 100,
      }),
    ).toEqual({
      fragments: {
        display: { data: { title: 'Edited' }, observedAt: 100, source: 'mutation' },
      },
      id: 'topic/1',
      kind: 'topic',
    });
    expect(() =>
      createProjectionFragmentEditRecord({
        data: {},
        projection: inspection.projection,
        fragmentName: 'unknown',
        observedAt: 100,
      }),
    ).toThrow('does not exist');
  });

  it('accepts JSON objects as fragment data and rejects scalar or array roots', () => {
    expect(parseProjectionFragmentDraft('{"title":"Edited"}')).toEqual({ title: 'Edited' });
    expect(() => parseProjectionFragmentDraft('["Edited"]')).toThrow('must be a JSON object');
    expect(() => parseProjectionFragmentDraft('{')).toThrow('must be valid JSON');
  });
});
