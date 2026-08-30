import { describe, expect, it } from 'vitest';

import type { ProjectionScopeState } from '../core/initialState';
import { applyProjectionCommit } from '../core/reducer';
import { defineProjectionQuery, executeProjectionQuery, executeProjectionRequest } from './runtime';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('Projection Query Runtime', () => {
  it('preserves request-start ordering when concurrent responses settle out of order', async () => {
    const requests = {
      older: deferred<{ title: string }>(),
      newer: deferred<{ title: string }>(),
    };
    const observations = new Map<string, number>();
    let projection: ProjectionScopeState | undefined;
    const query = defineProjectionQuery<{ id: keyof typeof requests }, { title: string }>({
      project: (response, { observedAt }) => {
        projection = applyProjectionCommit(projection, {
          records: [
            {
              fragments: {
                display: { data: response, observedAt, source: 'network' },
              },
              id: 'topic-1',
              kind: 'topic',
            },
          ],
        });
      },
      query: ({ id }, context) => {
        observations.set(id, context.observedAt);
        return requests[id].promise;
      },
    });

    const older = executeProjectionQuery(query, { id: 'older' }, 'scope-a');
    const newer = executeProjectionQuery(query, { id: 'newer' }, 'scope-a');
    expect(observations.get('newer')).toBeGreaterThan(observations.get('older')!);

    requests.newer.resolve({ title: 'Newer response' });
    await newer;
    requests.older.resolve({ title: 'Older response' });
    await older;

    expect(projection?.records.topic['topic-1'].fragments.display?.data).toEqual({
      title: 'Newer response',
    });
  });

  it('does not publish the request marker until the Projection commit completes', async () => {
    const projectionCommit = deferred<void>();
    const response = { id: 'agent-1', title: 'Agent One' };
    const query = defineProjectionQuery<Record<string, never>, typeof response>({
      project: () => projectionCommit.promise,
      query: async () => response,
    });
    let markerSettled = false;
    const markerRequest = executeProjectionRequest(query, {}, 'scope-a').then((value) => {
      markerSettled = true;
      return value;
    });

    await Promise.resolve();
    expect(markerSettled).toBe(false);

    projectionCommit.resolve();

    await expect(markerRequest).resolves.toEqual({ observedAt: expect.any(Number) });
  });
});
