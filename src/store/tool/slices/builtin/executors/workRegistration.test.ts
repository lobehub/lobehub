import { beforeEach, describe, expect, it, vi } from 'vitest';

import { takeWorkIntent } from '@/utils/clientWorkIntentStash';

vi.mock('@lobechat/builtin-tools', () => ({
  builtinTools: [
    {
      identifier: 'lobe-task',
      manifest: {
        api: [
          { name: 'createTask', work: { action: 'create', resourceType: 'task' } },
          { name: 'createTasks', work: { action: 'create', resourceType: 'task' } },
          { name: 'editTask', work: { action: 'update', resourceType: 'task' } },
          { name: 'deleteTask', work: { action: 'delete', resourceType: 'task' } },
          { name: 'listTasks' },
        ],
      },
    },
  ],
}));

const { stashBuiltinToolWorkIntent } = await import('./workRegistration');

const ctx = {
  agentId: 'agent-1',
  operationId: 'op-child',
  rootOperationId: 'op-root',
  threadId: 'thread-1',
  toolCallId: 'tool-call-1',
  toolMessageId: 'msg-tool-1',
  topicId: 'topic-1',
} as any;

describe('stashBuiltinToolWorkIntent (client dispatch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Drain any leftover from a prior test so the shared stash starts clean.
    takeWorkIntent(ctx.toolCallId);
  });

  it('stashes a created-task intent with the resolved target', () => {
    stashBuiltinToolWorkIntent('lobe-task', 'createTask', { instruction: 'do', name: 'A' }, ctx, {
      content: '',
      state: { identifier: 'T-1', success: true, taskId: 'task_1' },
      success: true,
    });

    expect(takeWorkIntent(ctx.toolCallId)).toEqual({
      action: 'create',
      changeType: 'created',
      targets: [{ taskId: 'task_1', taskIdentifier: 'T-1' }],
      type: 'task',
    });
  });

  it('stashes an update intent (changeType "updated") resolved via args.identifier', () => {
    stashBuiltinToolWorkIntent(
      'lobe-task',
      'editTask',
      { identifier: 'T-9', name: 'Edited' },
      ctx,
      {
        content: '',
        success: true,
      },
    );

    expect(takeWorkIntent(ctx.toolCallId)).toEqual({
      action: 'update',
      changeType: 'updated',
      targets: [{ taskId: undefined, taskIdentifier: 'T-9' }],
      type: 'task',
    });
  });

  it('stashes only the succeeded items of a partially failed batch', () => {
    stashBuiltinToolWorkIntent('lobe-task', 'createTasks', { tasks: [] }, ctx, {
      content: '',
      state: {
        failed: 1,
        results: [
          { identifier: 'T-A', name: 'A', success: true },
          { error: 'boom', name: 'B', success: false },
        ],
        succeeded: 1,
      },
      success: false,
    });

    expect(takeWorkIntent(ctx.toolCallId)).toEqual({
      action: 'create',
      changeType: 'created',
      targets: [{ taskId: undefined, taskIdentifier: 'T-A' }],
      type: 'task',
    });
  });

  it('stashes a delete intent carrying the resolved target', () => {
    stashBuiltinToolWorkIntent('lobe-task', 'deleteTask', { identifier: 'T-1' }, ctx, {
      content: '',
      state: { identifier: 'T-1', success: true, taskId: 'task_1' },
      success: true,
    });

    expect(takeWorkIntent(ctx.toolCallId)).toEqual({
      action: 'delete',
      targets: [{ taskId: 'task_1', taskIdentifier: 'T-1' }],
      type: 'task',
    });
  });

  it('stashes nothing when the delete call failed (no targets)', () => {
    stashBuiltinToolWorkIntent('lobe-task', 'deleteTask', { identifier: 'T-1' }, ctx, {
      content: 'boom',
      success: false,
    });

    expect(takeWorkIntent(ctx.toolCallId)).toBeUndefined();
  });

  it('stashes nothing for an API without a work config', () => {
    stashBuiltinToolWorkIntent('lobe-task', 'listTasks', {}, ctx, { content: '', success: true });

    expect(takeWorkIntent(ctx.toolCallId)).toBeUndefined();
  });

  it('stashes nothing when the call failed (no targets)', () => {
    stashBuiltinToolWorkIntent('lobe-task', 'editTask', { identifier: 'T-1' }, ctx, {
      content: 'boom',
      success: false,
    });

    expect(takeWorkIntent(ctx.toolCallId)).toBeUndefined();
  });

  it('stashes nothing when the tool call has no toolCallId to key by', () => {
    stashBuiltinToolWorkIntent(
      'lobe-task',
      'createTask',
      { name: 'A' },
      { ...ctx, toolCallId: undefined },
      { content: '', state: { identifier: 'T-1', success: true }, success: true },
    );

    expect(takeWorkIntent(ctx.toolCallId)).toBeUndefined();
  });
});
