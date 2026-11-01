import { describe, expect, it } from 'vitest';

import { heteroOperationCapabilities } from './heteroOperationCapabilities';

describe('heteroOperationCapabilities', () => {
  it('grants history reads only to a Channel dispatch', () => {
    expect(heteroOperationCapabilities('read the discussion', { channel: true })).toContain(
      'channel:read',
    );
    expect(heteroOperationCapabilities('read the discussion')).not.toContain('channel:read');
  });
  it('grants goal management to a /goal run', () => {
    expect(heteroOperationCapabilities('/goal ship the report')).toContain('goal:manage');
  });

  it('keeps goal management out of an ordinary run', () => {
    // Every hetero run used to carry it, so text met during a normal coding run
    // could drive `lh goal create --conversation` and start uncapped work.
    expect(heteroOperationCapabilities('fix the build')).toEqual([
      'hetero:ingest',
      'hetero:finish',
      'hetero:intervention:read',
    ]);
    expect(heteroOperationCapabilities(undefined)).not.toContain('goal:manage');
  });

  it('lets a Task run file evidence into its own verification round', () => {
    // On a device logged in as another member, the operation token is the only
    // identity that can reach the round its creator owns.
    expect(heteroOperationCapabilities('align the profile card', { taskId: 'task_1' })).toContain(
      'acceptance:evidence',
    );
  });

  it('keeps acceptance evidence out of a run with no Task', () => {
    expect(heteroOperationCapabilities('fix the build')).not.toContain('acceptance:evidence');
    expect(heteroOperationCapabilities('fix the build', {})).not.toContain('acceptance:evidence');
  });
});
