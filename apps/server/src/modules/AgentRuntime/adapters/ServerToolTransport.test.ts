import type { ToolRunContext } from '@lobechat/agent-runtime';
import type * as AgentRuntimeObservability from '@lobechat/observability-otel/modules/agent-runtime';
import {
  ATTR_LOBEHUB_TOOL_EXECUTION_TARGET,
  ATTR_LOBEHUB_TOOL_TIMEOUT_MS,
} from '@lobechat/observability-otel/modules/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import type * as ExecutorHelpers from '../executorHelpers';
import { ServerToolTransport } from './ServerToolTransport';

const mocks = vi.hoisted(() => {
  const executeToolSpan = {
    addEvent: vi.fn(),
    end: vi.fn(),
    recordException: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
  };

  return {
    archiveRuntimeToolResult: vi.fn(async (result) => result),
    dispatchClientTool: vi.fn(),
    executeToolSpan,
    resolveToolTimeoutMs: vi.fn(() => 4321),
    startSpan: vi.fn(() => executeToolSpan),
  };
});

vi.mock('@lobechat/observability-otel/modules/agent-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentRuntimeObservability>();

  return {
    ...actual,
    tracer: { startSpan: mocks.startSpan },
  };
});

vi.mock('../dispatchClientTool', () => ({
  dispatchClientTool: mocks.dispatchClientTool,
}));

vi.mock('../executorHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutorHelpers>();

  return {
    ...actual,
    archiveRuntimeToolResult: mocks.archiveRuntimeToolResult,
  };
});

vi.mock('../resolveToolTimeout', () => ({
  resolveToolTimeoutMs: mocks.resolveToolTimeoutMs,
}));

describe('ServerToolTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dispatchClientTool.mockResolvedValue({
      content: 'result',
      executionTime: 12,
      success: true,
    });
  });

  it('records the client target, effective timeout, execution completion, and blocking stages', async () => {
    const onStage = vi.fn();
    const hookDispatcher = {
      dispatch: vi.fn().mockResolvedValue(undefined),
      dispatchBeforeToolCall: vi.fn().mockResolvedValue(null),
    };
    const transport = new ServerToolTransport({
      hookDispatcher,
      onStage,
      operationId: 'operation-1',
      serverDB: {},
      stepIndex: 2,
      streamManager: { sendToolExecute: vi.fn() },
      toolExecutionService: {},
      userId: 'user-1',
    } as unknown as RuntimeExecutorContext);
    const payload = {
      apiName: 'search',
      executor: 'client',
      id: 'call-1',
      identifier: 'workspace',
    } as ChatToolPayload;
    const context = {
      callIndex: 0,
      effectiveManifestMap: {},
      parentMessageId: 'assistant-message-1',
      parsedArgs: { query: 'docs' },
      state: { metadata: {} },
      toolMessageId: 'tool-message-1',
      toolName: 'search',
      toolResultMaxLength: 1000,
      toolSource: 'builtin',
    } as unknown as ToolRunContext;

    await transport.run(payload, context);

    expect(onStage.mock.calls.map(([stage]) => stage)).toEqual([
      'hook.before_tool',
      'tool.client.wait',
      'tool.result.archive',
    ]);
    expect(mocks.executeToolSpan.setAttributes).toHaveBeenCalledWith({
      [ATTR_LOBEHUB_TOOL_EXECUTION_TARGET]: 'client',
      [ATTR_LOBEHUB_TOOL_TIMEOUT_MS]: 4321,
    });
    expect(mocks.executeToolSpan.addEvent).toHaveBeenCalledWith('tool.execute.complete', {
      'lobehub.tool.attempts': 1,
    });
  });

  it('does not report a deferred tool dispatch as execution complete', async () => {
    mocks.dispatchClientTool.mockResolvedValue({
      content: 'pending',
      deferred: true,
      executionTime: 12,
      success: true,
    });
    const transport = new ServerToolTransport({
      operationId: 'operation-1',
      serverDB: {},
      stepIndex: 2,
      streamManager: { sendToolExecute: vi.fn() },
      toolExecutionService: {},
      userId: 'user-1',
    } as unknown as RuntimeExecutorContext);

    await transport.run(
      {
        apiName: 'call',
        executor: 'client',
        id: 'call-1',
        identifier: 'async-tool',
      } as ChatToolPayload,
      {
        callIndex: 0,
        effectiveManifestMap: {},
        parentMessageId: 'assistant-message-1',
        parsedArgs: {},
        state: { metadata: {} },
        toolMessageId: 'tool-message-1',
        toolName: 'call',
        toolResultMaxLength: 1000,
        toolSource: 'builtin',
      } as unknown as ToolRunContext,
    );

    expect(mocks.executeToolSpan.addEvent).not.toHaveBeenCalledWith(
      'tool.execute.complete',
      expect.anything(),
    );
  });
});
