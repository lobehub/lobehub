import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { OpenCodeAdapter } from './opencode';

const adaptJsonl = async (adapter: OpenCodeAdapter, fixture: string) => {
  const jsonl = await readFile(
    new URL(`./__fixtures__/opencode/${fixture}`, import.meta.url),
    'utf8',
  );
  return jsonl
    .trim()
    .split('\n')
    .flatMap((line) => adapter.adapt(JSON.parse(line)));
};

describe('OpenCodeAdapter', () => {
  it('maps completed text/reasoning blocks and multi-step usage', async () => {
    const adapter = new OpenCodeAdapter();
    const events = await adaptJsonl(adapter, 'basic.jsonl');

    expect(adapter.sessionId).toBe('ses_open_1');
    expect(events.map(({ type }) => type)).toEqual([
      'stream_start',
      'stream_chunk',
      'stream_chunk',
      'step_complete',
      'stream_end',
      'stream_start',
      'stream_chunk',
      'step_complete',
    ]);
    expect(events[1].data).toEqual({ chunkType: 'reasoning', reasoning: 'I should inspect it.' });
    expect(events[2].data).toEqual({ chunkType: 'text', content: 'First answer.' });
    expect(events[3].data).toEqual({
      costUsd: 0.012,
      phase: 'turn_metadata',
      provider: 'opencode',
      usage: {
        inputCachedTokens: 30,
        inputCacheMissTokens: 100,
        inputWriteCacheTokens: 5,
        outputReasoningTokens: 20,
        outputTextTokens: 50,
        totalInputTokens: 135,
        totalOutputTokens: 70,
        totalTokens: 205,
      },
    });
    expect(events[7].data.usage).toMatchObject({
      inputCacheMissTokens: 20,
      totalInputTokens: 70,
      totalOutputTokens: 10,
      totalTokens: 80,
    });
    expect(events[7].stepIndex).toBe(1);
  });

  it.each([
    ['completed', { output: 'done' }, false, 'done'],
    ['error', { error: 'permission denied' }, true, 'permission denied'],
  ])('maps a terminal %s tool exactly once', (status, result, isError, content) => {
    const adapter = new OpenCodeAdapter();
    const raw = {
      part: {
        callID: 'call-1',
        id: 'part-tool-1',
        state: { input: { path: '/tmp/a' }, status, ...result },
        tool: 'read',
        type: 'tool',
      },
      sessionID: 'ses-tools',
      type: 'tool_use',
    };

    const events = adapter.adapt(raw);
    expect(events.map(({ type }) => type)).toEqual(['stream_chunk', 'tool_result', 'tool_end']);
    expect(events[0].data.toolsCalling[0]).toMatchObject({
      apiName: 'read',
      arguments: '{"path":"/tmp/a"}',
      id: 'call-1',
      identifier: 'opencode',
    });
    expect(events[1].data).toMatchObject({ content, isError, toolCallId: 'call-1' });
    expect(events[2].data).toEqual({ isSuccess: !isError, toolCallId: 'call-1' });
    expect(adapter.adapt(raw)).toEqual([]);
  });

  it('suppresses duplicate completed part ids', () => {
    const adapter = new OpenCodeAdapter();
    const raw = {
      part: { id: 'text-1', text: 'hello', type: 'text' },
      sessionID: 'ses-duplicate',
      type: 'text',
    };
    expect(adapter.adapt(raw)).toHaveLength(1);
    expect(adapter.adapt(raw)).toEqual([]);
  });

  it('captures session id and emits a normalized fatal error', () => {
    const adapter = new OpenCodeAdapter();
    const events = adapter.adapt({
      error: { data: { message: 'Provider unavailable', statusCode: 503 }, name: 'ProviderError' },
      sessionID: 'ses-error',
      type: 'error',
    });

    expect(adapter.sessionId).toBe('ses-error');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      data: { agentType: 'opencode', message: 'Provider unavailable' },
      type: 'error',
    });
    expect(adapter.adapt({ error: { data: { message: 'duplicate' } }, type: 'error' })).toEqual([]);
  });

  it('classifies provider authentication failures for the shared status guide', () => {
    const adapter = new OpenCodeAdapter();
    const events = adapter.adapt({
      error: {
        data: { message: 'No API key configured', providerID: 'anthropic' },
        name: 'ProviderAuthError',
      },
      sessionID: 'ses-auth',
      type: 'error',
    });

    expect(events[0]).toMatchObject({
      data: {
        agentType: 'opencode',
        code: 'auth_required',
        docsUrl: 'https://opencode.ai/docs',
      },
      type: 'error',
    });
  });

  it('ignores malformed and unknown input', () => {
    const adapter = new OpenCodeAdapter();
    expect(adapter.adapt(null)).toEqual([]);
    expect(adapter.adapt('bad')).toEqual([]);
    expect(adapter.adapt({ type: 'future_event' })).toEqual([]);
    expect(adapter.adapt({ part: {}, type: 'text' })).toEqual([]);
  });

  it('flushes only an open stream and never synthesizes runtime completion', () => {
    const adapter = new OpenCodeAdapter();
    expect(adapter.flush()).toEqual([]);
    adapter.adapt({
      part: { id: 'start-1', type: 'step-start' },
      sessionID: 'ses-flush',
      type: 'step_start',
    });
    expect(adapter.flush().map(({ type }) => type)).toEqual(['stream_end']);
    expect(adapter.flush()).toEqual([]);
  });
});
