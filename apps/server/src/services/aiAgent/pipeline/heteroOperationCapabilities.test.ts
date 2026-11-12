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

  it('grants goal management to a turn the user sent, however they word it', () => {
    expect(
      heteroOperationCapabilities('你能否跑一个goal，把邮箱体验补齐', { userTurn: true }),
    ).toContain('goal:manage');
  });

  it('keeps goal management out of user-looking Task and Channel runs', () => {
    // A Task brief is generated and a Channel message can come from anyone, so
    // neither is the owner asking; a Task run creating goals would let goals nest.
    const options = { userTurn: true };
    expect(
      heteroOperationCapabilities('run a goal', { ...options, taskId: 'task_1' }),
    ).not.toContain('goal:manage');
    expect(heteroOperationCapabilities('run a goal', { ...options, channel: true })).not.toContain(
      'goal:manage',
    );
  });

  it('still honours an explicit /goal on a Task run', () => {
    expect(heteroOperationCapabilities('/goal ship it', { taskId: 'task_1' })).toContain(
      'goal:manage',
    );
  });

  it('keeps goal management out of an ordinary run', () => {
    // Every hetero run used to carry it, so a server-started run (Task, goal
    // planning, wakeups) could drive `lh goal create` and start uncapped work.
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
    expect(heteroOperationCapabilities('fix the build', {})).not.toContain('acceptance:evidence');
  });
});
