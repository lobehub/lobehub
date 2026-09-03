import type { ChatToolPayload } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BuiltinToolsExecutor } from '../builtin';
import type { ToolExecutionContext } from '../types';

const mocks = vi.hoisted(() => ({
  apiHandler: vi.fn(),
  checkCommand: vi.fn().mockResolvedValue({ allowed: true }),
  checkPath: vi.fn().mockResolvedValue({ allowed: true }),
  executeLobehubSkill: vi.fn(),
  logCommandExecution: vi.fn().mockResolvedValue(undefined),
}));
const mockApiHandler = mocks.apiHandler;

vi.mock('../serverRuntimes', () => ({
  hasServerRuntime: vi.fn().mockReturnValue(true),
  getServerRuntime: vi.fn(async () => ({ createDocument: mocks.apiHandler })),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    executeLobehubSkill: mocks.executeLobehubSkill,
  })),
}));
// Governance is mocked here purely to isolate BuiltinToolsExecutor's wiring
// (does it call checkCommand/logCommandExecution with the right shape, does a
// denial short-circuit, does a logging failure stay non-fatal) — policyGate's
// own matching/fail-open behavior has its own unit tests in
// `services/governance/__tests__/policyGate.test.ts`.
vi.mock('@/server/services/governance', () => ({
  checkCommand: mocks.checkCommand,
  checkPath: mocks.checkPath,
  COMMAND_BLOCKED_MESSAGE:
    'This command was blocked by an administrator-configured command governance rule for this user. Do not attempt this action again in any form.',
  FILE_BLOCKED_MESSAGE:
    'This file operation was blocked by an administrator-configured execution policy for this user. Do not attempt to read or write this path again in any form.',
  logCommandExecution: mocks.logCommandExecution,
}));

// The runtime mock above only exposes `createDocument`, but the manifest is the
// authoritative source of declared APIs — it also lists `listDocuments`, so an
// UNKNOWN_API hint sourced from the manifest must surface both.
vi.mock('@lobechat/builtin-tools', () => ({
  builtinTools: [
    {
      identifier: 'lobe-notebook',
      manifest: { api: [{ name: 'createDocument' }, { name: 'listDocuments' }] },
    },
    {
      identifier: 'lobe-task',
      manifest: {
        api: [
          { name: 'createTask', work: { action: 'create', resourceType: 'task' } },
          { name: 'createTasks', work: { action: 'create', resourceType: 'task' } },
          { name: 'editTask', work: { action: 'update', resourceType: 'task' } },
          { name: 'listTasks' },
        ],
      },
    },
  ],
}));

const buildPayload = (argsStr: string): ChatToolPayload => ({
  apiName: 'createDocument',
  arguments: argsStr,
  id: 't1',
  identifier: 'lobe-notebook',
  type: 'default' as any,
});

const context: ToolExecutionContext = {
  toolManifestMap: {},
  userId: 'user-1',
};

describe('BuiltinToolsExecutor truncated arguments', () => {
  const executor = new BuiltinToolsExecutor({} as any, 'user-1');

  beforeEach(() => {
    mockApiHandler.mockReset();
    mocks.executeLobehubSkill.mockReset();
  });

  it('short-circuits with TRUNCATED_ARGUMENTS when JSON is cut mid-object', async () => {
    const truncated = '{"title": "Report", "description": "foo", "type": "report"';

    const result = await executor.execute(buildPayload(truncated), context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TRUNCATED_ARGUMENTS');
    expect(result.content).toMatch(/truncated/i);
    expect(result.content).toMatch(/max_tokens/);
    // The raw truncated payload is echoed back so the model sees exactly what
    // it produced and cannot blame upstream for a different payload.
    expect(result.content).toContain(truncated);
    expect(mockApiHandler).not.toHaveBeenCalled();
  });

  it('short-circuits with TRUNCATED_ARGUMENTS when a string value is unterminated', async () => {
    const truncated = '{"title": "Report", "content": "this is cut';

    const result = await executor.execute(buildPayload(truncated), context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TRUNCATED_ARGUMENTS');
    expect(result.content).toMatch(/unterminated string/);
    expect(result.content).toContain(truncated);
    expect(mockApiHandler).not.toHaveBeenCalled();
  });

  it('still dispatches to the runtime for valid JSON missing required fields', async () => {
    mockApiHandler.mockResolvedValueOnce({
      content: 'Error: Missing content. The document content is required.',
      success: false,
    });

    const result = await executor.execute(
      buildPayload('{"title": "Report", "type": "report"}'),
      context,
    );

    expect(mockApiHandler).toHaveBeenCalledWith({ title: 'Report', type: 'report' }, context);
    // The schema-level error from the runtime passes through untouched.
    expect(result.success).toBe(false);
    expect(result.content).toMatch(/Missing content/);
  });

  it('returns INVALID_JSON_ARGUMENTS for balanced-but-invalid JSON (not truncated)', async () => {
    // Balanced brackets but invalid syntax (unquoted key). Not a truncation,
    // but still unparseable — reject with a non-truncation error rather than
    // silently passing `{}` to the tool.
    const invalid = '{title: "Report"}';

    const result = await executor.execute(buildPayload(invalid), context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_JSON_ARGUMENTS');
    expect(result.content).toMatch(/not valid JSON/);
    expect(result.content).toContain(invalid);
    expect(mockApiHandler).not.toHaveBeenCalled();
  });

  // verify the self-reflection signal survives the new persist-time
  // sanitizer. The fix sanitizes `tool_calls[].arguments` only at DB/state
  // boundaries (to unbreak strict providers), so the raw bad string must still
  // reach the executor — otherwise the model loses the "fix your JSON syntax"
  // feedback and degrades to a generic "missing required field" error.
  it('emits INVALID_JSON_ARGUMENTS for the Qwen shape with raw args echoed', async () => {
    const invalid = '{, "description": "Create data models", "language": "python"}';

    const result = await executor.execute(buildPayload(invalid), context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_JSON_ARGUMENTS');
    expect(result.content).toMatch(/not valid JSON/);
    // Critical: the raw malformed string must appear in the tool-result content
    // so the model can self-correct based on what it actually produced.
    expect(result.content).toContain(invalid);
    expect(mockApiHandler).not.toHaveBeenCalled();
  });

  it('still dispatches normally when argsStr is empty', async () => {
    mockApiHandler.mockResolvedValueOnce({ content: 'ok', success: true });

    // Empty arguments are legitimate for tools that take no params —
    // parse falls through to `{}` without triggering the invalid-JSON guard.
    const result = await executor.execute(buildPayload(''), context);

    expect(mockApiHandler).toHaveBeenCalledWith({}, context);
    expect(result.success).toBe(true);
  });

  it('returns a recoverable UNKNOWN_API error for a hallucinated apiName', async () => {
    // The runtime mock only exposes `createDocument`; calling a non-existent
    // API (e.g. a model hallucinating `viewTopic`) must NOT throw a hard error
    // — it should return a structured result that lists the real APIs so the
    // model can self-correct.
    const result = await executor.execute({ ...buildPayload('{}'), apiName: 'viewTopic' }, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UNKNOWN_API');
    expect(result.content).toContain('viewTopic');
    // The available APIs are surfaced to guide the model.
    expect(result.content).toContain('createDocument');
    // Sourced from the manifest, not the runtime instance: `listDocuments` is
    // declared in the manifest yet absent from the mocked runtime's own keys,
    // so its presence proves the hint reads the manifest.
    expect(result.content).toContain('listDocuments');
    expect(mockApiHandler).not.toHaveBeenCalled();
  });

  it('lists prototype-method APIs via the fallback when no manifest is available', async () => {
    // A runtime whose APIs are class prototype methods (the common case).
    // `Object.keys(runtime)` would miss these, collapsing the hint to an empty
    // list; the prototype-chain fallback must surface them.
    class FooRuntime {
      async barApi() {
        return { content: 'ok', success: true };
      }
    }
    const { getServerRuntime } = await import('../serverRuntimes');
    vi.mocked(getServerRuntime).mockResolvedValueOnce(new FooRuntime() as any);

    const result = await executor.execute(
      { ...buildPayload('{}'), apiName: 'hallucinated', identifier: 'lobe-unknown-tool' },
      context,
    );

    expect(result.error?.code).toBe('UNKNOWN_API');
    expect(result.content).toContain('barApi');
  });

  it('emits a Linear skill Work intent after a successful server-side LobeHub Skill tool call', async () => {
    mocks.executeLobehubSkill.mockResolvedValueOnce({
      content: JSON.stringify({
        id: 'LINEAR-10966',
        status: 'In Progress',
        title: 'Linear Work issue',
        url: 'https://linear.app/lobehub/issue/LINEAR-10966/linear-work-issue',
      }),
      success: true,
    });

    const result = await executor.execute(
      {
        apiName: 'save_issue',
        arguments: '{"id":"LINEAR-10966","state":"In Progress"}',
        id: 'tool-call-linear',
        identifier: 'linear',
        source: 'lobehubSkill',
        type: 'default' as any,
      },
      { ...context, executionTimeoutMs: 45_000, topicId: 'topic-1' },
    );

    expect(result.success).toBe(true);
    expect(mocks.executeLobehubSkill).toHaveBeenCalledWith({
      args: { id: 'LINEAR-10966', state: 'In Progress' },
      context: { topicId: 'topic-1' },
      provider: 'linear',
      timeoutMs: 45_000,
      toolName: 'save_issue',
    });
    // The executor no longer writes the Work — it hands the runtime an intent
    // carrying the UNTRUNCATED payload; provenance + cost are stamped by the
    // agent runtime at persist time.
    expect(result.workRegistration).toEqual({
      args: { id: 'LINEAR-10966', state: 'In Progress' },
      data: {
        id: 'LINEAR-10966',
        status: 'In Progress',
        title: 'Linear Work issue',
        url: 'https://linear.app/lobehub/issue/LINEAR-10966/linear-work-issue',
      },
      provider: 'linear',
      toolName: 'save_issue',
      type: 'skill',
    });
  });

  it('emits a GitHub skill Work intent after a successful server-side LobeHub Skill tool call', async () => {
    mocks.executeLobehubSkill.mockResolvedValueOnce({
      content: JSON.stringify({
        html_url: 'https://github.com/lobehub/lobehub/issues/123',
        node_id: 'I_kwDOJj1234',
        number: 123,
        state: 'open',
        title: 'GitHub Work issue',
      }),
      success: true,
    });

    const result = await executor.execute(
      {
        apiName: 'create_issue',
        arguments: '{"owner":"lobehub","repo":"lobehub","title":"GitHub Work issue"}',
        id: 'tool-call-github',
        identifier: 'github',
        source: 'lobehubSkill',
        type: 'default' as any,
      },
      { ...context, topicId: 'topic-1' },
    );

    expect(result.success).toBe(true);
    expect(result.workRegistration).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ number: 123 }),
        provider: 'github',
        toolName: 'create_issue',
        type: 'skill',
      }),
    );
  });

  it('emits no Work intent for non-adapted skill providers', async () => {
    mocks.executeLobehubSkill.mockResolvedValueOnce({
      content: JSON.stringify({ id: 'msg-1' }),
      success: true,
    });

    const result = await executor.execute(
      {
        apiName: 'send_message',
        arguments: '{}',
        id: 'tool-call-ms',
        identifier: 'microsoft',
        source: 'lobehubSkill',
        type: 'default' as any,
      },
      { ...context, topicId: 'topic-1' },
    );

    expect(result.success).toBe(true);
    expect(result.workRegistration).toBeUndefined();
  });
});

describe('BuiltinToolsExecutor manifest-driven Work registration', () => {
  const executor = new BuiltinToolsExecutor({} as any, 'user-1');

  const taskContext: ToolExecutionContext = {
    agentId: 'agent-1',
    operationId: 'op-child',
    rootOperationId: 'op-root',
    serverDB: {} as NonNullable<ToolExecutionContext['serverDB']>,
    threadId: 'thread-1',
    toolCallId: 'tool-call-task',
    toolManifestMap: {},
    toolMessageId: 'msg-tool-task',
    topicId: 'topic-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
  };

  const taskPayload = (apiName: string, argsStr = '{}'): ChatToolPayload => ({
    apiName,
    arguments: argsStr,
    id: 'tool-call-task',
    identifier: 'lobe-task',
    type: 'default' as any,
  });

  it('emits a task Work intent after a successful createTask, reading identity from state', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    vi.mocked(getServerRuntime).mockResolvedValueOnce({
      createTask: vi.fn().mockResolvedValue({
        content: 'ok',
        state: { identifier: 'T-1', success: true, taskId: 'task_1' },
        success: true,
      }),
    } as any);

    const result = await executor.execute(
      taskPayload('createTask', '{"name":"A","instruction":"do"}'),
      taskContext,
    );

    expect(result.success).toBe(true);
    // Provenance (agent / operation / message / tool-call ids) is added by the
    // agent runtime at persist time, so the intent carries only the resolved
    // action + targets.
    expect(result.workRegistration).toEqual({
      action: 'create',
      changeType: 'created',
      targets: [{ taskId: 'task_1', taskIdentifier: 'T-1' }],
      type: 'task',
    });
  });

  it('emits an intent for only the succeeded items of a partial-failure batch', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    vi.mocked(getServerRuntime).mockResolvedValueOnce({
      createTasks: vi.fn().mockResolvedValue({
        content: 'ok',
        state: {
          failed: 1,
          results: [
            { identifier: 'T-A', name: 'A', success: true },
            { error: 'boom', name: 'B', success: false },
          ],
          succeeded: 1,
        },
        success: false,
      }),
    } as any);

    const result = await executor.execute(taskPayload('createTasks', '{"tasks":[]}'), taskContext);

    expect(result.workRegistration).toEqual({
      action: 'create',
      changeType: 'created',
      targets: [{ taskIdentifier: 'T-A' }],
      type: 'task',
    });
  });

  it('emits no intent for an API without a work config', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    vi.mocked(getServerRuntime).mockResolvedValueOnce({
      listTasks: vi.fn().mockResolvedValue({ content: 'ok', success: true }),
    } as any);

    const result = await executor.execute(taskPayload('listTasks'), taskContext);

    expect(result.workRegistration).toBeUndefined();
  });

  it('emits no intent when the update failed (no extractable target)', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    vi.mocked(getServerRuntime).mockResolvedValueOnce({
      editTask: vi.fn().mockResolvedValue({ content: 'Task not found', success: false }),
    } as any);

    const result = await executor.execute(
      taskPayload('editTask', '{"identifier":"T-404"}'),
      taskContext,
    );

    expect(result.workRegistration).toBeUndefined();
  });

  it('emits an update intent for a successful editTask', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    vi.mocked(getServerRuntime).mockResolvedValueOnce({
      editTask: vi.fn().mockResolvedValue({ content: 'edited', success: true }),
    } as any);

    const result = await executor.execute(
      taskPayload('editTask', '{"identifier":"T-1","name":"Edited"}'),
      taskContext,
    );

    expect(result.success).toBe(true);
    expect(result.workRegistration).toEqual({
      action: 'update',
      changeType: 'updated',
      targets: [{ taskIdentifier: 'T-1' }],
      type: 'task',
    });
  });
});

describe('BuiltinToolsExecutor command governance hook', () => {
  const executor = new BuiltinToolsExecutor({} as any, 'user-1');

  const commandPayload: ChatToolPayload = {
    apiName: 'runCommand',
    arguments: '{"command":"rm -rf /","description":"danger"}',
    id: 'tool-call-cmd',
    identifier: 'lobe-local-system',
    type: 'default' as any,
  };

  beforeEach(() => {
    mocks.checkCommand.mockReset().mockResolvedValue({ allowed: true });
    mocks.logCommandExecution.mockReset().mockResolvedValue(undefined);
  });

  it('never touches governance for a non-command-shaped tool call', async () => {
    mockApiHandler.mockReset().mockResolvedValueOnce({ content: 'ok', success: true });

    await executor.execute(buildPayload('{}'), context);

    expect(mocks.checkCommand).not.toHaveBeenCalled();
    expect(mocks.logCommandExecution).not.toHaveBeenCalled();
  });

  it('checks the command, dispatches to the runtime, and logs a success outcome when allowed', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const runCommandMock = vi.fn().mockResolvedValue({ content: 'done', success: true });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ runCommand: runCommandMock } as any);

    const result = await executor.execute(commandPayload, {
      ...context,
      activeDeviceId: 'device-1',
    });

    expect(mocks.checkCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'runCommand',
        commandText: 'rm -rf /',
        deviceId: 'device-1',
        executionTarget: 'device',
        toolIdentifier: 'lobe-local-system',
        userId: 'user-1',
      }),
      expect.anything(),
    );
    expect(runCommandMock).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(mocks.logCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({ commandText: 'rm -rf /' }),
      expect.objectContaining({ blocked: false, success: true }),
      expect.anything(),
    );
  });

  it('tags a local-system runCommand call with executionTarget "local" when the plan resolved to local', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const runCommandMock = vi.fn().mockResolvedValue({ content: 'done', success: true });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ runCommand: runCommandMock } as any);

    await executor.execute(commandPayload, {
      ...context,
      activeDeviceId: 'device-1',
      deviceExecutionTarget: 'local',
    });

    expect(mocks.checkCommand).toHaveBeenCalledWith(
      expect.objectContaining({ executionTarget: 'local' }),
      expect.anything(),
    );
  });

  it('falls back to executionTarget "device" when deviceExecutionTarget is "auto" or absent', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const runCommandMock = vi.fn().mockResolvedValue({ content: 'done', success: true });
    vi.mocked(getServerRuntime).mockResolvedValue({ runCommand: runCommandMock } as any);

    await executor.execute(commandPayload, {
      ...context,
      activeDeviceId: 'device-1',
      deviceExecutionTarget: 'auto',
    });

    expect(mocks.checkCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ executionTarget: 'device' }),
      expect.anything(),
    );
  });

  it('tags a cloud-sandbox runCommand call with executionTarget "sandbox"', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const runCommandMock = vi.fn().mockResolvedValue({ content: 'done', success: true });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ runCommand: runCommandMock } as any);

    await executor.execute({ ...commandPayload, identifier: 'lobe-cloud-sandbox' }, context);

    expect(mocks.checkCommand).toHaveBeenCalledWith(
      expect.objectContaining({ executionTarget: 'sandbox' }),
      expect.anything(),
    );
  });

  it('returns a structured COMMAND_BLOCKED error and never calls the runtime when denied', async () => {
    mocks.checkCommand.mockReset().mockResolvedValueOnce({ allowed: false, ruleId: 'rule-1' });
    const { getServerRuntime } = await import('../serverRuntimes');
    const runCommandMock = vi.fn();
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ runCommand: runCommandMock } as any);

    const result = await executor.execute(commandPayload, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_BLOCKED');
    expect(runCommandMock).not.toHaveBeenCalled();
    expect(mocks.logCommandExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ blocked: true, matchedRuleId: 'rule-1' }),
      expect.anything(),
    );
  });

  it('still returns the real tool result when logCommandExecution rejects', async () => {
    mocks.logCommandExecution.mockReset().mockRejectedValue(new Error('audit db down'));
    const { getServerRuntime } = await import('../serverRuntimes');
    const runCommandMock = vi.fn().mockResolvedValue({ content: 'done', success: true });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ runCommand: runCommandMock } as any);

    const result = await executor.execute(commandPayload, context);

    // The audit-log rejection must be swallowed — the real tool outcome wins.
    expect(result.success).toBe(true);
    expect(result.content).toBe('done');
  });

  it('logs a failure outcome (not a masked result) when the runtime call throws', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const runCommandMock = vi.fn().mockRejectedValue(new Error('spawn failed'));
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ runCommand: runCommandMock } as any);

    const result = await executor.execute(commandPayload, context);

    expect(result.success).toBe(false);
    expect(result.content).toBe('spawn failed');
    expect(mocks.logCommandExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ blocked: false, errorMessage: 'spawn failed', success: false }),
      expect.anything(),
    );
  });
});

describe('BuiltinToolsExecutor file governance hook', () => {
  const executor = new BuiltinToolsExecutor({} as any, 'user-1');

  const filePayload: ChatToolPayload = {
    apiName: 'writeFile',
    arguments: '{"path":"/home/alice/.ssh/config","content":"evil"}',
    id: 'tool-call-file',
    identifier: 'lobe-local-system',
    type: 'default' as any,
  };

  beforeEach(() => {
    mocks.checkPath.mockReset().mockResolvedValue({ allowed: true });
    mocks.checkCommand.mockReset().mockResolvedValue({ allowed: true });
    mocks.logCommandExecution.mockReset().mockResolvedValue(undefined);
  });

  it('never touches file governance for a non-file-shaped tool call', async () => {
    mockApiHandler.mockReset().mockResolvedValueOnce({ content: 'ok', success: true });

    await executor.execute(buildPayload('{}'), context);

    expect(mocks.checkPath).not.toHaveBeenCalled();
  });

  it('never touches file governance for a cloud-sandbox writeFile call', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const writeFileMock = vi.fn().mockResolvedValue({ content: 'done', success: true });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ writeFile: writeFileMock } as any);

    await executor.execute({ ...filePayload, identifier: 'lobe-cloud-sandbox' }, context);

    expect(mocks.checkPath).not.toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalled();
  });

  it('checks the path, dispatches to the runtime, and logs a success outcome when allowed', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const writeFileMock = vi.fn().mockResolvedValue({ content: 'done', success: true });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ writeFile: writeFileMock } as any);

    const result = await executor.execute(filePayload, { ...context, activeDeviceId: 'device-1' });

    expect(mocks.checkPath).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'writeFile',
        deviceId: 'device-1',
        executionTarget: 'device',
        path: '/home/alice/.ssh/config',
        toolIdentifier: 'lobe-local-system',
        userId: 'user-1',
      }),
      expect.anything(),
    );
    expect(writeFileMock).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(mocks.logCommandExecution).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/home/alice/.ssh/config' }),
      expect.objectContaining({ blocked: false, success: true }),
      expect.anything(),
    );
  });

  it('resolves a relative path against context.workingDirectory before checking', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const writeFileMock = vi.fn().mockResolvedValue({ content: 'done', success: true });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ writeFile: writeFileMock } as any);

    await executor.execute(
      { ...filePayload, arguments: '{"path":"notes.txt","content":"hi"}' },
      { ...context, workingDirectory: '/home/alice/project' },
    );

    expect(mocks.checkPath).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/home/alice/project/notes.txt' }),
      expect.anything(),
    );
  });

  it('does not prepend workingDirectory to an already-absolute path', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const writeFileMock = vi.fn().mockResolvedValue({ content: 'done', success: true });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ writeFile: writeFileMock } as any);

    await executor.execute(filePayload, { ...context, workingDirectory: '/home/alice/project' });

    expect(mocks.checkPath).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/home/alice/.ssh/config' }),
      expect.anything(),
    );
  });

  it('returns a structured FILE_ACCESS_BLOCKED error and never calls the runtime when denied', async () => {
    mocks.checkPath.mockReset().mockResolvedValueOnce({
      allowed: false,
      matchedField: 'deniedWriteRoots',
    });
    const { getServerRuntime } = await import('../serverRuntimes');
    const writeFileMock = vi.fn();
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ writeFile: writeFileMock } as any);

    const result = await executor.execute(filePayload, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_ACCESS_BLOCKED');
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(mocks.logCommandExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ blocked: true, matchedField: 'deniedWriteRoots' }),
      expect.anything(),
    );
  });

  it('checks readFile against deniedReadRoots via the same chokepoint', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const readFileMock = vi.fn().mockResolvedValue({ content: 'secret', success: true });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ readFile: readFileMock } as any);

    await executor.execute(
      {
        ...filePayload,
        apiName: 'readFile',
        arguments: '{"path":"/home/alice/.ssh/config"}',
      },
      context,
    );

    expect(mocks.checkPath).toHaveBeenCalledWith(
      expect.objectContaining({ apiName: 'readFile' }),
      expect.anything(),
    );
  });

  it('checks searchFiles against its scope (not path) arg', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const searchMock = vi.fn().mockResolvedValue([]);
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ searchFiles: searchMock } as any);

    await executor.execute(
      {
        ...filePayload,
        apiName: 'searchFiles',
        arguments: '{"keywords":"todo","scope":"/home/alice/.ssh"}',
      },
      context,
    );

    expect(mocks.checkPath).toHaveBeenCalledWith(
      expect.objectContaining({ apiName: 'searchFiles', path: '/home/alice/.ssh' }),
      expect.anything(),
    );
  });

  it('checks editFile against its file_path (not path) arg — the manifest field name, not the IPC one', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const editMock = vi.fn().mockResolvedValue({ replacements: 1, success: true });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ editFile: editMock } as any);

    await executor.execute(
      {
        ...filePayload,
        apiName: 'editFile',
        arguments: JSON.stringify({
          file_path: '/home/alice/.ssh/config',
          new_string: 'b',
          old_string: 'a',
        }),
      },
      context,
    );

    expect(mocks.checkPath).toHaveBeenCalledWith(
      expect.objectContaining({ apiName: 'editFile', path: '/home/alice/.ssh/config' }),
      expect.anything(),
    );
  });

  it('checks globFiles against its scope (not path) arg', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const globMock = vi.fn().mockResolvedValue({ files: [], success: true, total_files: 0 });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ globFiles: globMock } as any);

    await executor.execute(
      {
        ...filePayload,
        apiName: 'globFiles',
        arguments: '{"pattern":"*.pem","scope":"/home/alice/.ssh"}',
      },
      context,
    );

    expect(mocks.checkPath).toHaveBeenCalledWith(
      expect.objectContaining({ apiName: 'globFiles', path: '/home/alice/.ssh' }),
      expect.anything(),
    );
  });

  it('checks every item of a moveFiles batch — both oldPath and newPath — not just the first', async () => {
    mocks.checkPath.mockReset().mockImplementation(async (ctx: any) => ({
      allowed: ctx.path !== '/home/alice/.ssh/authorized_keys',
      matchedField:
        ctx.path === '/home/alice/.ssh/authorized_keys' ? 'deniedWriteRoots' : undefined,
    }));
    const { getServerRuntime } = await import('../serverRuntimes');
    const moveMock = vi.fn().mockResolvedValue([]);
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ moveFiles: moveMock } as any);

    // First item is innocuous; the SECOND item's newPath is the denied one —
    // a check that only looked at items[0] would miss this entirely.
    const result = await executor.execute(
      {
        ...filePayload,
        apiName: 'moveFiles',
        arguments: JSON.stringify({
          items: [
            { newPath: '/home/alice/Desktop/notes.txt', oldPath: '/home/alice/Desktop/draft.txt' },
            {
              newPath: '/home/alice/.ssh/authorized_keys',
              oldPath: '/tmp/payload.txt',
            },
          ],
        }),
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_ACCESS_BLOCKED');
    expect(moveMock).not.toHaveBeenCalled();
    expect(mocks.checkPath).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/home/alice/Desktop/draft.txt' }),
      expect.anything(),
    );
    expect(mocks.checkPath).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/home/alice/.ssh/authorized_keys' }),
      expect.anything(),
    );
  });

  it('allows a moveFiles batch through and dispatches once every item passes', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const moveMock = vi.fn().mockResolvedValue([]);
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ moveFiles: moveMock } as any);

    const result = await executor.execute(
      {
        ...filePayload,
        apiName: 'moveFiles',
        arguments: JSON.stringify({
          items: [{ newPath: '/home/alice/Desktop/b.txt', oldPath: '/home/alice/Desktop/a.txt' }],
        }),
      },
      context,
    );

    expect(result.success).not.toBe(false);
    expect(moveMock).toHaveBeenCalled();
  });

  it('still returns the real tool result when logCommandExecution rejects', async () => {
    mocks.logCommandExecution.mockReset().mockRejectedValue(new Error('audit db down'));
    const { getServerRuntime } = await import('../serverRuntimes');
    const writeFileMock = vi.fn().mockResolvedValue({ content: 'done', success: true });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ writeFile: writeFileMock } as any);

    const result = await executor.execute(filePayload, context);

    expect(result.success).toBe(true);
    expect(result.content).toBe('done');
  });

  it('logs a failure outcome (not a masked result) when the runtime call throws', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const writeFileMock = vi.fn().mockRejectedValue(new Error('disk full'));
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ writeFile: writeFileMock } as any);

    const result = await executor.execute(filePayload, context);

    expect(result.success).toBe(false);
    expect(result.content).toBe('disk full');
    expect(mocks.logCommandExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ blocked: false, errorMessage: 'disk full', success: false }),
      expect.anything(),
    );
  });

  it('does not trigger command governance for a file-shaped call, and vice versa', async () => {
    const { getServerRuntime } = await import('../serverRuntimes');
    const writeFileMock = vi.fn().mockResolvedValue({ content: 'done', success: true });
    vi.mocked(getServerRuntime).mockResolvedValueOnce({ writeFile: writeFileMock } as any);

    await executor.execute(filePayload, context);

    expect(mocks.checkCommand).not.toHaveBeenCalled();
  });
});
