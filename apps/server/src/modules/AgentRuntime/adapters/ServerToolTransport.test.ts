import { describe, expect, it, vi } from 'vitest';

import { agentManagementRuntime } from '@/server/services/toolExecution/serverRuntimes/agentManagement';

import type { RuntimeExecutorContext } from '../context';
import { ServerToolTransport } from './ServerToolTransport';

/**
 * Sub-agent execution is not available for shared visitor runs. This must
 * fail closed at the `ServerToolTransport` injection site, which is what
 * actually builds the `ctx.subAgent` / `ctx.execSubAgent` runners handed to
 * the Agent Management runtime — independent of whether the manifest layer
 * already hides the dispatch APIs from the model's tool list.
 */
describe('ServerToolTransport — share-visitor sub-agent dispatch guard', () => {
  const baseChatToolPayload = {
    apiName: 'callAgent',
    executor: 'server',
    id: 'call-1',
    identifier: 'lobe-agent-management',
  } as any;

  const buildToolRunContext = (overrides: Record<string, any> = {}) =>
    ({
      callIndex: 0,
      effectiveManifestMap: {},
      mode: 'batch', // skip resolveAgentVisibility's DB lookup (only runs for 'single')
      operationId: 'op-1',
      parentMessageId: 'msg-1',
      parsedArgs: { agentId: 'target-agent', instruction: 'do the task' },
      state: { metadata: { agentId: 'creator-agent' } },
      stepIndex: 0,
      toolName: 'callAgent',
      ...overrides,
    }) as any;

  const buildCtx = (overrides: Record<string, any> = {}): RuntimeExecutorContext =>
    ({
      execSubAgent: vi.fn().mockResolvedValue({ success: true }),
      execVirtualSubAgent: vi.fn().mockResolvedValue({ started: true, threadId: 'thread-1' }),
      operationId: 'op-1',
      serverDB: {} as never,
      stepIndex: 0,
      streamManager: {},
      toolExecutionService: { executeTool: vi.fn() },
      topicId: 'topic-1',
      userId: 'creator-user',
      ...overrides,
    }) as unknown as RuntimeExecutorContext;

  it('withholds execSubAgent/subAgent runners from the executor for a share-visitor run', async () => {
    const executeTool = vi.fn().mockResolvedValue({ content: '', success: true });
    const ctx = buildCtx({
      agentShare: { agentId: 'creator-agent', visitorUserId: 'visitor-1' },
      toolExecutionService: { executeTool },
    });

    await new ServerToolTransport(ctx).run(baseChatToolPayload, buildToolRunContext());

    expect(executeTool).toHaveBeenCalledTimes(1);
    const options = executeTool.mock.calls[0][1];
    expect(options.execSubAgent).toBeUndefined();
    expect(options.subAgent).toBeUndefined();
  });

  it('injects live execSubAgent/subAgent runners for a normal (non-share) run', async () => {
    const executeTool = vi.fn().mockResolvedValue({ content: '', success: true });
    const ctx = buildCtx({ toolExecutionService: { executeTool } });

    await new ServerToolTransport(ctx).run(baseChatToolPayload, buildToolRunContext());

    expect(executeTool).toHaveBeenCalledTimes(1);
    const options = executeTool.mock.calls[0][1];
    expect(options.execSubAgent).toBeTypeOf('function');
    expect(options.subAgent).toBeDefined();
  });

  it('end-to-end: a share-visitor run reaches AgentManagement.callAgent with no subAgent runner and fails closed', async () => {
    const executeTool = vi.fn(async (_payload: any, options: any) =>
      agentManagementRuntime
        .factory({ serverDB: {} as never, toolManifestMap: {}, userId: 'creator-user' })
        .callAgent({ agentId: 'target-agent', instruction: 'do the task' }, options),
    );
    const ctx = buildCtx({
      agentShare: { agentId: 'creator-agent', visitorUserId: 'visitor-1' },
      toolExecutionService: { executeTool },
    });

    const execution = await new ServerToolTransport(ctx).run(
      baseChatToolPayload,
      buildToolRunContext(),
    );

    expect(execution.result.success).toBe(false);
    expect(execution.result.error).toMatchObject({ code: 'AGENT_CALL_UNAVAILABLE' });
  });
});
