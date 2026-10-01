import type {
  AfterToolCallHookEvent,
  BeforeToolCallObservationEvent,
  ToolCallErrorHookEvent,
  ToolCallHookEvent,
  ToolRunContext,
  ToolRunResult,
} from '@lobechat/agent-runtime';
import { AgentRuntime } from '@lobechat/agent-runtime';
import type { ChatToolPayload, ToolExecutor } from '@lobechat/types';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { buildToolCallHookContext } from './toolCallHookContext';

const call: ChatToolPayload = {
  apiName: 'search',
  arguments: '{"query":"original"}',
  executor: 'client',
  id: 'native-call-id',
  identifier: 'search-tool',
  source: 'mcp',
  type: 'default',
};

const createContext = (): ToolRunContext => ({
  callIndex: 7,
  effectiveManifestMap: {},
  mode: 'single',
  operationId: 'op-1',
  parentMessageId: 'assistant-1',
  parsedArgs: { query: 'effective' },
  state: AgentRuntime.createInitialState({ operationId: 'op-1', status: 'running', stepCount: 1 }),
  stepIndex: 1,
  toolMessageId: 'resumed-tool-message',
  toolName: 'search-tool/search',
});

const runtime = {
  operationId: 'op-1',
  stepIndex: 1,
  streamManager: { sendToolExecute: vi.fn() },
  topicId: 'runtime-topic',
  userId: 'user-1',
  workspaceId: 'runtime-workspace',
};

describe('buildToolCallHookContext', () => {
  it.each([
    {
      originUser: 'origin-owner',
      runtimeUser: undefined,
      visitor: 'visitor-1',
      user: 'origin-owner',
    },
    {
      originUser: 'origin-owner',
      runtimeUser: 'runtime-owner',
      visitor: 'visitor-1',
      user: 'runtime-owner',
    },
    {
      originUser: 'origin-owner',
      runtimeUser: 'runtime-owner',
      visitor: undefined,
      user: 'runtime-owner',
    },
    {
      originUser: 'origin-owner',
      runtimeUser: undefined,
      visitor: undefined,
      user: 'origin-owner',
    },
    {
      originUser: undefined,
      runtimeUser: undefined,
      visitor: 'visitor-1',
      user: undefined,
    },
    {
      originUser: undefined,
      runtimeUser: undefined,
      visitor: undefined,
      user: undefined,
    },
  ])(
    'resolves hook userId to the runtime owner $user',
    ({ originUser, runtimeUser, visitor, user }) => {
      const context = createContext();
      context.state.origin = { userId: originUser };
      if (visitor) {
        context.state.principal = {
          actor: {
            shareVisitor: { agentId: 'shared-agent', shareId: 'share-1', visitorUserId: visitor },
          },
        };
      }

      const event = buildToolCallHookContext(call, context, { ...runtime, userId: runtimeUser });

      expect(event.userId).toBe(user);
      expect(context.state.origin?.userId).toBe(originUser);
    },
  );

  it('reports invocation args and native call and message identifiers', () => {
    const context = createContext();
    const event = buildToolCallHookContext(call, context, runtime);

    expect(event.args).toEqual({ query: 'effective' });
    expect(event.toolCallId).toBe('native-call-id');
    expect(event.callIndex).toBe(7);
    expect(event.assistantMessageId).toBe('assistant-1');
    expect(event.toolMessageId).toBe('resumed-tool-message');
  });

  it('reports the client route only when the server can forward to the client', () => {
    expect(buildToolCallHookContext(call, createContext(), runtime)).toMatchObject({
      executor: 'client',
      toolSource: 'mcp',
    });
    expect(
      buildToolCallHookContext(call, createContext(), { ...runtime, streamManager: {} }),
    ).toMatchObject({ executor: 'server', toolSource: 'mcp' });
  });

  it('does not infer a parent from progress anchors or a device from a stale binding', () => {
    const context = createContext();
    context.state.origin = {
      lineage: { progressAnchor: { parentOperationId: 'progress-only', toolMessageId: 'anchor' } },
    };
    context.state.binding = { device: { id: 'stale-device' } };
    context.state.plan = { execution: { kind: 'sandbox', target: 'sandbox' } };
    const event = buildToolCallHookContext(call, context, runtime);

    expect(event.parentOperationId).toBeUndefined();
    expect(event.activeDeviceId).toBeUndefined();
    expect(event.executionTarget).toBe('sandbox');
    expect(event.topicId).toBe('runtime-topic');
    expect(event.workspaceId).toBe('runtime-workspace');
  });

  it('shares additive correlation types and keeps blocked results structured', () => {
    const event = buildToolCallHookContext(call, createContext(), runtime);
    expectTypeOf(event).toExtend<BeforeToolCallObservationEvent>();
    expectTypeOf(event.toolCallId).toEqualTypeOf<string>();
    expectTypeOf(event.assistantMessageId).toEqualTypeOf<string>();
    expectTypeOf(event.executor).toEqualTypeOf<ToolExecutor>();
    expectTypeOf(event.parentOperationId).toEqualTypeOf<string | undefined>();
    expectTypeOf({ ...event, mock: () => true }).toExtend<ToolCallHookEvent>();
    expectTypeOf({ ...event, error: 'failure' }).toExtend<ToolCallErrorHookEvent>();

    const after: AfterToolCallHookEvent = {
      ...event,
      mocked: false,
      result: { content: 'blocked', state: { type: 'blocked' }, success: false },
    };
    expectTypeOf(after.result).toEqualTypeOf<ToolRunResult>();
    expect(after.result.state?.type).toBe('blocked');
  });
});
