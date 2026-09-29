import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  AfterHumanInterventionHookEvent,
  BeforeHumanInterventionHookEvent,
  StopByHumanInterventionHookEvent,
  ToolCallHookContext,
} from '../types';
import {
  buildAfterHumanInterventionEvent,
  buildBeforeHumanInterventionEvent,
  buildHumanInterventionHookContext,
  buildStopByHumanInterventionEvent,
} from './humanInterventionHooks';

describe('human intervention notification payloads', () => {
  it('requires the tool caller identity without inventing one for run-level intervention', () => {
    expectTypeOf<ToolCallHookContext['assistantMessageId']>().toEqualTypeOf<string>();
    expectTypeOf<BeforeHumanInterventionHookEvent['assistantMessageId']>().toEqualTypeOf<
      string | undefined
    >();
    const context = buildHumanInterventionHookContext({}, { operationId: 'op' });
    expect(context).not.toHaveProperty('assistantMessageId');
  });

  it('carries the real origin through all three events and uses the actual operation', () => {
    const origin = {
      agentId: 'agent',
      documentId: 'document',
      groupId: 'group',
      lineage: { parentOperationId: 'actual-parent' },
      sessionId: 'session',
      sourceMessageId: 'source-user-message',
      taskId: 'task',
      threadId: 'thread',
      topicId: 'topic',
      userId: 'origin-user',
      workspaceId: 'workspace',
    };
    const context = buildHumanInterventionHookContext(
      { origin },
      { operationId: 'actual-operation', userId: 'operation-user' },
    );
    const expected = {
      agentId: 'agent',
      documentId: 'document',
      groupId: 'group',
      operationId: 'actual-operation',
      parentOperationId: 'actual-parent',
      sessionId: 'session',
      sourceMessageId: 'source-user-message',
      taskId: 'task',
      threadId: 'thread',
      topicId: 'topic',
      userId: 'operation-user',
      workspaceId: 'workspace',
    };
    expect(context).toEqual(expected);
    const events = [
      buildBeforeHumanInterventionEvent({ ...context, stepIndex: 3 }, []),
      buildAfterHumanInterventionEvent(context, { action: 'approve', toolCallIds: ['native'] }),
      buildStopByHumanInterventionEvent(context, {
        reason: 'human_rejected',
        toolCallIds: ['native'],
      }),
    ];
    for (const event of events) expect(event).toMatchObject(expected);
    expect(
      buildHumanInterventionHookContext({ origin }, { operationId: 'actual-operation' }).userId,
    ).toBe('origin-user');
    expect(origin.lineage).toEqual({ parentOperationId: 'actual-parent' });
  });

  it('snapshots final effective arguments and complete native ids from pending approval payloads', () => {
    const pending = ['native-second', 'native-first'].map((id, index) => ({
      apiName: 'write',
      arguments: JSON.stringify({ path: `/effective/${index}`, options: { overwrite: false } }),
      id,
      identifier: 'files',
      type: 'builtin' as const,
    }));
    const event = buildBeforeHumanInterventionEvent(
      { assistantMessageId: 'approval-owner', operationId: 'op', stepIndex: 3 },
      pending,
    );
    expect(event.pendingTools).toEqual(
      pending.map((tool) => ({
        apiName: 'write',
        args: JSON.parse(tool.arguments),
        arguments: tool.arguments,
        identifier: 'files',
        toolCallId: tool.id,
      })),
    );
    const firstArguments = pending[0].arguments;
    pending[0].arguments = '{"path":"later"}';
    pending.pop();
    expect(event.pendingTools).toHaveLength(2);
    expect(event.pendingTools[0].arguments).toBe(firstArguments);
    expect(event.pendingTools[0].args).toEqual({
      path: '/effective/0',
      options: { overwrite: false },
    });
    expect(event.assistantMessageId).toBe('approval-owner');
  });

  it.each(['approve', 'reject', 'rejectAndContinue'] as const)(
    'preserves every native id for batch %s',
    (action) => {
      const ids = ['native-2', 'native-1'];
      const event = buildAfterHumanInterventionEvent(
        { operationId: 'op' },
        { action, rejectionReason: 'reason', toolCallIds: ids },
      );
      ids.pop();
      expect(event).toEqual({
        action,
        operationId: 'op',
        rejectionReason: 'reason',
        toolCallId: undefined,
        toolCallIds: ['native-2', 'native-1'],
      });
    },
  );

  it('keeps the single id and copies complete stop membership', () => {
    const ids = ['native-1', 'native-2'];
    const event = buildStopByHumanInterventionEvent(
      { operationId: 'op' },
      {
        reason: 'human_rejected',
        rejectionReason: 'privacy',
        toolCallId: ids[0],
        toolCallIds: ids,
      },
    );
    ids.pop();
    expect(event).toMatchObject({
      reason: 'human_rejected',
      rejectionReason: 'privacy',
      toolCallId: 'native-1',
      toolCallIds: ['native-1', 'native-2'],
    });
  });

  it('uses the legacy single id for a singleton action or stop', () => {
    expect(
      buildAfterHumanInterventionEvent(
        { operationId: 'op' },
        { action: 'approve', toolCallIds: ['native'] },
      ).toolCallId,
    ).toBe('native');
    expect(
      buildStopByHumanInterventionEvent(
        { operationId: 'op' },
        { reason: 'human_rejected', toolCallIds: ['native'] },
      ).toolCallId,
    ).toBe('native');
  });

  it('does not manufacture parent/root identity from a continuation or source message', () => {
    const event = buildHumanInterventionHookContext(
      {
        origin: {
          continuation: {
            resolutionRequestId: 'decision',
            sourceOperationId: 'previous-run',
            sourceToolMessageIds: ['message'],
          },
          sourceMessageId: 'user-message',
        },
      },
      { operationId: 'actual-run' },
    );
    expect(event.operationId).toBe('actual-run');
    expect(event.parentOperationId).toBeUndefined();
    expect(event).not.toHaveProperty('rootOperationId');
    expect(event.assistantMessageId).toBeUndefined();
  });

  it.each(['{broken', '[]', 'null'])(
    'retains exact card arguments when no parsed record is available: %s',
    (argumentsText) => {
      const event = buildBeforeHumanInterventionEvent({ operationId: 'op', stepIndex: 2 }, [
        {
          apiName: 'write',
          arguments: argumentsText,
          id: 'native',
          identifier: 'files',
          type: 'builtin',
        },
      ]);
      expect(event.pendingTools[0]).toEqual({
        apiName: 'write',
        args: undefined,
        arguments: argumentsText,
        identifier: 'files',
        toolCallId: 'native',
      });
    },
  );

  it('keeps existing minimal event producers compatible', () => {
    const before: BeforeHumanInterventionHookEvent = {
      operationId: 'op',
      pendingTools: [{ apiName: 'write', identifier: 'files' }],
      stepIndex: 1,
    };
    const after: AfterHumanInterventionHookEvent = {
      action: 'approve',
      operationId: 'op',
      toolCallId: 'native',
    };
    const stop: StopByHumanInterventionHookEvent = { operationId: 'op', rejectionReason: 'no' };
    expect([before, after, stop].map(({ operationId }) => operationId)).toEqual(['op', 'op', 'op']);
  });
});
