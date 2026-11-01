import { describe, expect, it } from 'vitest';

import {
  buildWorkflowRunGuardKeys,
  buildWorkflowRunGuardRedisKey,
  hashWorkflowRunGuardStepName,
  normalizeWorkflowRunGuardPath,
} from '../keys';

describe('workflow run guard keys', () => {
  /**
   * @example
   * normalizeWorkflowRunGuardPath('/api/workflows/memory-user-memory/')
   * // returns 'api/workflows/memory-user-memory'
   */
  it('normalizes workflow paths without origin or leading slash', () => {
    expect(
      normalizeWorkflowRunGuardPath(
        'https://app.lobehub.com/api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
      ),
    ).toBe('api/workflows/memory-user-memory/pipelines/chat-topic/process-topic');

    expect(normalizeWorkflowRunGuardPath('/api/workflows/memory-user-memory/')).toBe(
      'api/workflows/memory-user-memory',
    );
  });

  /**
   * @example
   * normalizeWorkflowRunGuardPath('/api/workflows/demo?x=1#hash')
   * // returns 'api/workflows/demo'
   */
  it('normalizes relative workflow paths without query or hash', () => {
    // ROOT CAUSE:
    //
    // Relative paths with query strings did not go through URL parsing because
    // `new URL(value)` requires an absolute URL. The fallback returned the raw
    // value, so `/api/workflows/demo?x=1#hash` and the absolute URL form built
    // different guard keys.
    //
    // We fixed this by parsing relative paths with a dummy base URL before
    // trimming leading and trailing slashes.
    expect(normalizeWorkflowRunGuardPath('/api/workflows/demo?x=1#hash')).toBe(
      'api/workflows/demo',
    );
    expect(normalizeWorkflowRunGuardPath('api/workflows/demo?x=1#hash')).toBe('api/workflows/demo');
  });

  /**
   * @example
   * buildWorkflowRunGuardRedisKey({ type: 'global' })
   * // returns 'workflow:run-guard:global'
   */
  it('builds direct scope keys', () => {
    expect(buildWorkflowRunGuardRedisKey({ type: 'global' })).toBe('workflow:run-guard:global');
    expect(
      buildWorkflowRunGuardRedisKey({
        type: 'path',
        workflowPath: 'api/workflows/memory-user-memory',
      }),
    ).toBe('workflow:run-guard:path:api/workflows/memory-user-memory');
    expect(buildWorkflowRunGuardRedisKey({ type: 'user', userId: 'user-1' })).toBe(
      'workflow:run-guard:user:user-1',
    );
    expect(buildWorkflowRunGuardRedisKey({ type: 'run', workflowRunId: 'wfr_1' })).toBe(
      'workflow:run-guard:run:wfr_1',
    );
  });

  /**
   * @example
   * hashWorkflowRunGuardStepName('memory:user-memory:extract:cepa')
   * // returns a stable 16-character lowercase hex string
   */
  it('hashes step names into stable short keys', () => {
    expect(hashWorkflowRunGuardStepName('memory:user-memory:extract:cepa')).toMatch(
      /^[a-f0-9]{16}$/,
    );
    expect(hashWorkflowRunGuardStepName('memory:user-memory:extract:cepa')).toBe(
      hashWorkflowRunGuardStepName('memory:user-memory:extract:cepa'),
    );
  });

  /**
   * @example
   * buildWorkflowRunGuardKeys({ workflowPath: 'api/workflows/demo' })
   * // returns global and path-prefix candidates in check order
   */
  it('builds check keys in guard order with path prefixes', () => {
    expect(
      buildWorkflowRunGuardKeys({
        stepName: 'memory:user-memory:extract:cepa',
        userId: 'user-1',
        workflowPath: 'api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
        workflowRunId: 'wfr_1',
      }).map((item) => item.key),
    ).toEqual([
      'workflow:run-guard:global',
      'workflow:run-guard:path:api',
      'workflow:run-guard:path:api/workflows',
      'workflow:run-guard:path:api/workflows/memory-user-memory',
      'workflow:run-guard:path:api/workflows/memory-user-memory/pipelines',
      'workflow:run-guard:path:api/workflows/memory-user-memory/pipelines/chat-topic',
      'workflow:run-guard:path:api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
      'workflow:run-guard:user:user-1',
      'workflow:run-guard:run:wfr_1',
      `workflow:run-guard:step:wfr_1:${hashWorkflowRunGuardStepName('memory:user-memory:extract:cepa')}`,
    ]);
  });
});
