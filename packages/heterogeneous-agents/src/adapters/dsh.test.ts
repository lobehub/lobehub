import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { DshAdapter } from './dsh';

const adaptJsonl = async (adapter: DshAdapter, fixture: string) => {
  const jsonl = await readFile(new URL(`./__fixtures__/dsh/${fixture}`, import.meta.url), 'utf8');
  return jsonl
    .trim()
    .split('\n')
    .flatMap((line) => adapter.adapt(JSON.parse(line)));
};

const notify = (method: string, params: unknown) => ({ jsonrpc: '2.0', method, params });

const sessionEvent = (sessionId: string, type: string, data: unknown, seq = 1) =>
  notify('session.event', { event: { data, seq, time: 0, type }, sessionId });

describe('DshAdapter', () => {
  it('maps a two-step tool turn from the harness session log', async () => {
    const adapter = new DshAdapter();
    const events = await adaptJsonl(adapter, 'basic.jsonl');

    expect(adapter.sessionId).toBe('dsh-session-1');
    expect(events.map(({ type }) => type)).toEqual([
      'stream_start',
      'stream_chunk',
      'stream_chunk',
      'stream_chunk',
      'stream_end',
      'step_complete',
      'tool_start',
      'tool_result',
      'tool_end',
      'stream_start',
      'stream_chunk',
      'stream_end',
      'step_complete',
      'visible_output_end',
      'agent_runtime_end',
    ]);
  });

  it('carries the route onto stream_start and splits steps by index', async () => {
    const adapter = new DshAdapter();
    const events = await adaptJsonl(adapter, 'basic.jsonl');
    const starts = events.filter(({ type }) => type === 'stream_start');

    expect(starts[0].data).toMatchObject({
      model: 'deepseek-v4-pro',
      provider: 'deepseek-harness',
      sessionId: 'dsh-session-1',
    });
    expect(starts[0].data.newStep).toBeUndefined();
    expect(starts[1].data).toMatchObject({
      model: 'deepseek-v4-pro',
      newStep: true,
      provider: 'deepseek-harness',
      sessionId: 'dsh-session-1',
    });
    expect(starts.map(({ stepIndex }) => stepIndex)).toEqual([0, 1]);
  });

  it('maps reasoning, text, and assembled tool calls onto chunk types', async () => {
    const adapter = new DshAdapter();
    const events = await adaptJsonl(adapter, 'basic.jsonl');
    const chunks = events.filter(({ type }) => type === 'stream_chunk').map(({ data }) => data);

    expect(chunks[0]).toEqual({
      chunkType: 'reasoning',
      reasoning: 'Need to read the file first.',
    });
    expect(chunks[1]).toEqual({ chunkType: 'text', content: 'Reading it now.' });
    // Only the assembled `block-end` produces a tool call — the partial
    // `tool-call-delta` before it must not emit a payload with truncated args.
    expect(chunks[2]).toEqual({
      chunkType: 'tools_calling',
      toolsCalling: [
        {
          apiName: 'read_file',
          arguments: '{"path":"README.md"}',
          id: 'call_a1',
          identifier: 'deepseek-harness',
          type: 'default',
        },
      ],
    });
  });

  it('keeps harness disjoint input counts and treats reasoning as an output subset', async () => {
    const adapter = new DshAdapter();
    const events = await adaptJsonl(adapter, 'basic.jsonl');
    const first = events.find(({ type }) => type === 'step_complete');

    expect(first?.data).toEqual({
      model: 'deepseek-v4-pro',
      phase: 'turn_metadata',
      provider: 'deepseek-harness',
      usage: {
        inputCachedTokens: 900,
        inputCacheMissTokens: 100,
        inputWriteCacheTokens: 0,
        outputReasoningTokens: 20,
        // 50 output tokens INCLUDE the 20 reasoning tokens.
        outputTextTokens: 30,
        totalInputTokens: 1000,
        totalOutputTokens: 50,
        totalTokens: 1050,
      },
    });
  });

  it('pairs tool_result with tool_end and re-attaches the dispatched payload', async () => {
    const adapter = new DshAdapter();
    const events = await adaptJsonl(adapter, 'basic.jsonl');

    const result = events.find(({ type }) => type === 'tool_result');
    expect(result?.data).toEqual({ content: '# DeepSeek Harness', toolCallId: 'call_a1' });

    const end = events.find(({ type }) => type === 'tool_end');
    expect(end?.data).toMatchObject({
      isSuccess: true,
      payload: { toolCalling: { identifier: 'deepseek-harness' } },
      result: { content: '# DeepSeek Harness', success: true },
      toolCallId: 'call_a1',
    });
  });

  it('reports a failed turn as a terminal error before closing the stream', () => {
    const adapter = new DshAdapter();
    adapter.adapt(sessionEvent('s1', 'step/start', { step: 1, turn: 1 }));
    const events = adapter.adapt(
      sessionEvent('s1', 'turn/end', {
        reason: { error: { code: 'RATE_LIMIT', message: 'slow down' }, kind: 'error' },
        turn: 1,
      }),
    );

    // The step opened but produced nothing, so its stream is still pending —
    // the error needs an assistant message to land on.
    expect(events.map(({ type }) => type)).toEqual([
      'stream_start',
      'error',
      'stream_end',
      'visible_output_end',
    ]);
    expect(events[1].data).toMatchObject({
      agentType: 'deepseek-harness',
      code: 'RATE_LIMIT',
      message: 'slow down',
    });
  });

  it('reports a retried request as stream_retry, not a run failure', () => {
    const adapter = new DshAdapter();
    adapter.adapt(sessionEvent('s1', 'step/start', { step: 1, turn: 1 }));

    // A failed attempt the retry plugin recovers arrives as a terminal `finish`
    // chunk. Reporting it as `error` puts a failure card on a run that succeeds.
    expect(
      adapter.adapt(
        sessionEvent('s1', 'assistant/chunk', {
          chunk: {
            reason: { failure: { code: 'TIMEOUT', message: 'timed out' }, kind: 'error' },
            type: 'finish',
          },
        }),
      ),
    ).toEqual([]);

    const retry = adapter.adapt(
      sessionEvent('s1', 'llm/retry', {
        delayMs: 1000,
        failure: { code: 'TIMEOUT', message: 'timed out' },
        maxRetries: 3,
        mode: 'normal',
        retry: 1,
        step: 1,
        turn: 1,
      }),
    );
    expect(retry.map(({ type }) => type)).toEqual(['stream_retry']);
    expect(retry[0].data).toMatchObject({ attempt: 1, delayMs: 1000, maxAttempts: 3 });
  });

  it('forwards a model-generated session title and skips the deterministic fallback', () => {
    const adapter = new DshAdapter();
    adapter.adapt(sessionEvent('s1', 'step/start', { step: 1, turn: 1 }));

    // The harness fallback is a truncation of the first user message — worse
    // than the consumer's own summarization, so it must not cross.
    expect(
      adapter.adapt(
        sessionEvent('s1', 'session/title', {
          messageSeqs: [4],
          source: { kind: 'fallback' },
          title: 'Read the file and',
        }),
      ),
    ).toEqual([]);

    const generated = adapter.adapt(
      sessionEvent('s1', 'session/title', {
        messageSeqs: [4],
        source: { kind: 'provider', provider: 'llm' },
        title: 'Document the turn lifecycle',
      }),
    );
    expect(generated.map(({ type }) => type)).toEqual(['session_title']);
    expect(generated[0].data).toEqual({ origin: 'model', title: 'Document the turn lifecycle' });

    const renamed = adapter.adapt(
      sessionEvent('s1', 'session/title', {
        messageSeqs: [],
        source: { kind: 'user' },
        title: 'My thread',
      }),
    );
    expect(renamed[0].data).toEqual({ origin: 'user', title: 'My thread' });
  });

  it('drops a subagent session title, which describes the subtask', () => {
    const adapter = new DshAdapter();
    adapter.adapt(sessionEvent('parent', 'step/start', { step: 1, turn: 1 }));
    adapter.adapt(
      sessionEvent('parent', 'tool/call', { arguments: '{}', callId: 'c1', name: 'subagent' }),
    );
    adapter.adapt(
      notify('subagent.started', { childSessionId: 'child', parentSessionId: 'parent' }),
    );

    expect(
      adapter.adapt(
        sessionEvent('child', 'session/title', {
          messageSeqs: [1],
          source: { kind: 'provider', provider: 'llm' },
          title: 'echo probe subtask',
        }),
      ),
    ).toEqual([]);
  });

  it('drops sessions belonging to other clients of the same runtime', () => {
    const adapter = new DshAdapter();
    adapter.adapt(sessionEvent('mine', 'step/start', { step: 1, turn: 1 }));

    expect(adapter.adapt(sessionEvent('someone-else', 'step/start', { step: 1, turn: 1 }))).toEqual(
      [],
    );
    expect(
      adapter.adapt(
        sessionEvent('someone-else', 'assistant/chunk', {
          chunk: { index: 0, text: 'not mine', type: 'text-delta' },
        }),
      ),
    ).toEqual([]);
  });

  it('stamps subagent context onto a linked child session', () => {
    const adapter = new DshAdapter();
    adapter.adapt(sessionEvent('parent', 'step/start', { step: 1, turn: 1 }));
    adapter.adapt(
      sessionEvent('parent', 'tool/call', {
        arguments: '{"task":"audit the docs"}',
        callId: 'call_task_1',
        name: 'subagent',
      }),
    );
    adapter.adapt(
      notify('subagent.started', { childSessionId: 'child', parentSessionId: 'parent' }),
    );
    // A child session opens with lifecycle frames that map to no event; they
    // must not consume the spawn metadata the executor needs to open the Thread.
    expect(adapter.adapt(sessionEvent('child', 'turn/start', { turn: 1 }))).toEqual([]);

    const first = adapter.adapt(
      sessionEvent('child', 'assistant/chunk', {
        chunk: { index: 0, text: 'working', type: 'text-delta' },
      }),
    );
    expect(first[0].data).toMatchObject({
      chunkType: 'text',
      content: 'working',
      subagent: {
        parentToolCallId: 'call_task_1',
        spawnMetadata: { description: 'subagent', prompt: 'audit the docs' },
      },
    });

    // Spawn metadata rides out once; later child events carry the link only.
    const second = adapter.adapt(
      sessionEvent('child', 'assistant/chunk', {
        chunk: { index: 0, text: ' more', type: 'text-delta' },
      }),
    );
    expect((second[0].data as any).subagent).toEqual({ parentToolCallId: 'call_task_1' });
  });

  it('does not open a second main stream for a subagent step', () => {
    const adapter = new DshAdapter();
    adapter.adapt(sessionEvent('parent', 'step/start', { step: 1, turn: 1 }));
    adapter.adapt(
      sessionEvent('parent', 'tool/call', {
        arguments: '{}',
        callId: 'call_task_1',
        name: 'subagent',
      }),
    );
    adapter.adapt(
      notify('subagent.started', { childSessionId: 'child', parentSessionId: 'parent' }),
    );

    expect(adapter.adapt(sessionEvent('child', 'step/start', { step: 1, turn: 1 }))).toEqual([]);
    expect(
      adapter.adapt(sessionEvent('child', 'turn/end', { reason: { kind: 'completed' }, turn: 1 })),
    ).toEqual([]);
  });

  it('ignores unknown event types, unknown chunk types, and unknown methods', () => {
    const adapter = new DshAdapter();
    adapter.adapt(sessionEvent('s1', 'step/start', { step: 1, turn: 1 }));

    // The harness event map, content blocks, and finish reasons are all
    // merge-extensible — a plugin-added tag must not break the stream.
    expect(adapter.adapt(sessionEvent('s1', 'plugin/whatever', { anything: true }))).toEqual([]);
    expect(
      adapter.adapt(sessionEvent('s1', 'assistant/chunk', { chunk: { type: 'plugin-delta' } })),
    ).toEqual([]);
    expect(adapter.adapt(notify('some.future.notification', {}))).toEqual([]);
    expect(adapter.adapt(null)).toEqual([]);
  });

  it('closes an interrupted stream on flush', () => {
    const adapter = new DshAdapter();
    adapter.adapt(sessionEvent('s1', 'step/start', { step: 1, turn: 1 }));
    adapter.adapt(
      sessionEvent('s1', 'assistant/chunk', {
        chunk: { index: 0, text: 'half a sen', type: 'text-delta' },
      }),
    );

    expect(adapter.flush().map(({ type }) => type)).toEqual(['stream_end', 'agent_runtime_end']);
    expect(adapter.flush()).toEqual([]);
  });

  it('opens no stream for a step that died before producing output', () => {
    const adapter = new DshAdapter();
    adapter.adapt(sessionEvent('s1', 'step/start', { step: 1, turn: 1 }));

    expect(adapter.flush().map(({ type }) => type)).toEqual(['agent_runtime_end']);
  });
});
