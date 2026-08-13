import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { CodexAdapter } from './codex';
import { CodexAppServerAdapter } from './codexAppServer';

const loadFixture = async () => {
  const source = await readFile(
    new URL('./__fixtures__/codex/app-server-single-turn.jsonl', import.meta.url),
    'utf8',
  );
  return source
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { method: string; params: unknown });
};

const loadParityFixture = async () => {
  const source = await readFile(
    new URL('./__fixtures__/codex/app-server-vs-exec.json', import.meta.url),
    'utf8',
  );
  return JSON.parse(source) as {
    appServer: Array<{ method: string; params: unknown }>;
    exec: unknown[];
  };
};

describe('CodexAppServerAdapter', () => {
  it('maps a native v2 turn directly into the existing stream contract', async () => {
    const adapter = new CodexAppServerAdapter({ initialModel: 'gpt-5.5-codex' });
    const raw = await loadFixture();
    const events = raw.flatMap(({ method, params }) => adapter.adapt(method, params));

    expect(
      events.filter(({ type }) => type === 'stream_chunk').map(({ data }) => data.chunkType),
    ).toEqual([
      'reasoning',
      'tools_calling',
      'tool_state',
      'tools_calling',
      'tools_calling',
      'tool_state',
      'text',
    ]);
    expect(
      events
        .findLast(({ data, type }) => type === 'stream_chunk' && data.chunkType === 'tools_calling')
        ?.data.toolsCalling.map(({ id }: { id: string }) => id),
    ).toEqual(['command-1', 'mcp-1', 'turn-plan-turn-1']);
    expect(
      events.filter(({ type }) => type === 'tool_result').map(({ data }) => data.toolCallId),
    ).toEqual(['command-1', 'mcp-1', 'turn-plan-turn-1']);
    expect(
      events.find(({ data, type }) => type === 'stream_chunk' && data.chunkType === 'reasoning')
        ?.data.reasoning,
    ).toBe('Inspecting the workspace');
    expect(
      events
        .filter(({ data, type }) => type === 'stream_chunk' && data.chunkType === 'text')
        .map(({ data }) => data.content),
    ).toEqual(['Done.']);
    expect(
      events.find(({ data, type }) => type === 'step_complete' && data.usage)?.data.usage,
    ).toMatchObject({
      inputCachedTokens: 2,
      inputCacheMissTokens: 8,
      outputReasoningTokens: 3,
      outputTextTokens: 4,
      totalTokens: 17,
    });
    expect(events.at(-1)).toMatchObject({ type: 'agent_runtime_end' });
  });

  it('ignores unknown notification methods for forward compatibility', () => {
    const adapter = new CodexAppServerAdapter();

    expect(adapter.adapt('future/notification', { threadId: 'thread-1' })).toEqual([]);
  });

  it('keeps unfinished plan state when a turn is interrupted', () => {
    const adapter = new CodexAppServerAdapter();
    const planEvents = adapter.adapt('turn/plan/updated', {
      explanation: null,
      plan: [
        { status: 'completed', step: 'Inspect' },
        { status: 'inProgress', step: 'Implement' },
        { status: 'pending', step: 'Verify' },
      ],
      threadId: 'thread-1',
      turnId: 'turn-1',
    });

    const terminalEvents = adapter.interruptForTransportFailure();

    expect(
      planEvents.find(({ data }) => data.chunkType === 'tool_state')?.data.pluginState.todos.items,
    ).toEqual([
      { status: 'completed', text: 'Inspect' },
      { status: 'processing', text: 'Implement' },
      { status: 'todo', text: 'Verify' },
    ]);
    expect(
      terminalEvents.find(
        ({ data, type }) => type === 'tool_end' && data.toolCallId === 'turn-plan-turn-1',
      ),
    ).toMatchObject({ data: { isSuccess: false } });
    expect(
      terminalEvents.some(
        ({ data, type }) => type === 'tool_result' && data.toolCallId === 'turn-plan-turn-1',
      ),
    ).toBe(false);
  });

  it('truncates oversized completed command output before persisting the result', () => {
    const adapter = new CodexAppServerAdapter();
    const item = {
      aggregatedOutput: 'x'.repeat(25_010),
      command: 'print-output',
      durationMs: 1,
      exitCode: 0,
      id: 'command-large',
      status: 'completed',
      type: 'commandExecution',
    };
    adapter.adapt('item/started', {
      item: {
        ...item,
        aggregatedOutput: null,
        durationMs: null,
        exitCode: null,
        status: 'inProgress',
      },
      startedAtMs: 1,
      threadId: 'thread-1',
      turnId: 'turn-1',
    });

    const events = adapter.adapt('item/completed', {
      completedAtMs: 2,
      item,
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
    const result = events.find(({ type }) => type === 'tool_result')?.data;

    expect(result.content).toContain(
      '[Output truncated: 10 characters omitted. Original length: 25010 characters]',
    );
    expect(result.pluginState).toMatchObject({
      omittedOutputCharacters: 10,
      originalOutputLength: 25_010,
      outputTruncated: true,
    });
    expect(result.content).toHaveLength(25_078);
    expect(result.pluginState.output).toBe(result.content);
    expect(result.pluginState.stdout).toBe(result.content);
  });

  it.each([
    {
      code: 'rate_limit',
      info: 'usageLimitExceeded',
      kind: 'usage_limit',
      message: 'Usage limit reached',
    },
    {
      code: 'overloaded',
      info: 'serverOverloaded',
      kind: 'server_overloaded',
      message: 'Server overloaded',
    },
    {
      code: 'overloaded',
      info: { responseStreamDisconnected: { httpStatusCode: 502 } },
      kind: 'network_drop',
      message: 'Response stream disconnected',
    },
  ])('classifies native $kind failures', ({ code, info, kind, message }) => {
    const adapter = new CodexAppServerAdapter();

    const events = adapter.adapt('error', {
      error: { additionalDetails: null, codexErrorInfo: info, message },
      threadId: 'thread-1',
      turnId: 'turn-1',
      willRetry: false,
    });

    expect(events.at(-1)).toMatchObject({
      data: {
        code,
        details: {
          codexErrorInfo: info,
          kind,
          ...(kind === 'network_drop' ? { httpStatusCode: 502 } : {}),
        },
        message,
      },
      type: 'error',
    });
  });

  it('keeps native and exec adapters semantically aligned during migration', async () => {
    const fixture = await loadParityFixture();
    const nativeAdapter = new CodexAppServerAdapter();
    const execAdapter = new CodexAdapter();
    const nativeEvents = fixture.appServer.flatMap(({ method, params }) =>
      nativeAdapter.adapt(method, params),
    );
    const execEvents = fixture.exec.flatMap((event) => execAdapter.adapt(event));
    const summarize = (events: typeof nativeEvents) => ({
      text: events
        .filter(({ data, type }) => type === 'stream_chunk' && data.chunkType === 'text')
        .map(({ data }) => data.content)
        .join(''),
      toolResults: events
        .filter(({ type }) => type === 'tool_result')
        .map(({ data }) => ({ content: data.content, id: data.toolCallId })),
      toolStarts: events
        .filter(({ type }) => type === 'tool_start')
        .map(({ data }) => data.toolCallId),
      totalTokens: events.find(({ data, type }) => type === 'step_complete' && data.usage)?.data
        .usage.totalTokens,
      types: events.map(({ type }) => type),
    });

    expect(summarize(nativeEvents)).toEqual(summarize(execEvents));
  });
});
