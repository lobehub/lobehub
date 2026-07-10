import { describe, expect, it, vi } from 'vitest';

import { AgentStreamPipeline } from './agentStreamPipeline';

const init = (sessionId = 'cc-1') =>
  `${JSON.stringify({
    model: 'claude-sonnet-4-6',
    session_id: sessionId,
    subtype: 'init',
    type: 'system',
  })}\n`;

const ccText = (msgId: string, text: string) =>
  `${JSON.stringify({
    message: {
      content: [{ text, type: 'text' }],
      id: msgId,
      model: 'claude-sonnet-4-6',
      role: 'assistant',
    },
    type: 'assistant',
  })}\n`;

const ccReadImage = (toolCallId = 'r1') =>
  `${JSON.stringify({
    message: {
      content: [{ id: toolCallId, input: { file_path: 'x.png' }, name: 'Read', type: 'tool_use' }],
      id: 'msg_read',
      model: 'claude-sonnet-4-6',
      role: 'assistant',
    },
    type: 'assistant',
  })}\n${JSON.stringify({
    message: {
      content: [
        {
          content: [
            { source: { data: 'AAAA', media_type: 'image/png', type: 'base64' }, type: 'image' },
          ],
          tool_use_id: toolCallId,
          type: 'tool_result',
        },
      ],
      role: 'user',
    },
    type: 'user',
  })}\n`;

const imagesOf = (events: { data?: any; type: string }[]) =>
  events.find((e) => e.type === 'tool_result')?.data?.pluginState?.images;

const contentOf = (events: { data?: any; type: string }[]) =>
  events.find((e) => e.type === 'tool_result')?.data?.content;

describe('AgentStreamPipeline', () => {
  it('runs JSONL → adapter → toStreamEvent and stamps operationId', async () => {
    const pipeline = new AgentStreamPipeline({
      agentType: 'claude-code',
      operationId: 'op-42',
    });

    const events = await pipeline.push(init() + ccText('msg_01', 'hello'));

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.operationId).toBe('op-42');
    }
    expect(pipeline.sessionId).toBe('cc-1');
  });

  it('exposes the adapter session id once the init event is parsed', async () => {
    const pipeline = new AgentStreamPipeline({
      agentType: 'claude-code',
      operationId: 'op-1',
    });

    expect(pipeline.sessionId).toBeUndefined();
    await pipeline.push(init('cc-99'));
    expect(pipeline.sessionId).toBe('cc-99');
  });

  it('auto-wires the Codex file-change tracker for codex agents only', async () => {
    // claude-code → no codex tracker, file_change payloads pass through untouched
    const claude = new AgentStreamPipeline({ agentType: 'claude-code', operationId: 'op-1' });
    expect((claude as any).codexTracker).toBeUndefined();

    // codex → tracker is instantiated automatically; consumers stay agent-agnostic
    const codex = new AgentStreamPipeline({ agentType: 'codex', operationId: 'op-1' });
    expect((codex as any).codexTracker).toBeDefined();
  });

  it('emits an initial Codex model metadata event before stdout-derived events', async () => {
    const pipeline = new AgentStreamPipeline({
      agentType: 'codex',
      initialModel: 'gpt-5.5',
      operationId: 'op-codex',
    });

    const events = await pipeline.push(`${JSON.stringify({ type: 'turn.started' })}\n`);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      data: {
        model: 'gpt-5.5',
        phase: 'turn_metadata',
        provider: 'codex',
      },
      operationId: 'op-codex',
      type: 'step_complete',
    });
    expect(events[1]).toMatchObject({
      data: { model: 'gpt-5.5', provider: 'codex' },
      operationId: 'op-codex',
      type: 'stream_start',
    });
  });

  it('passes initial Codex cumulative usage into the adapter for resumed turns', async () => {
    const pipeline = new AgentStreamPipeline({
      agentType: 'codex',
      initialCumulativeUsage: {
        inputCacheMissTokens: 100,
        totalInputTokens: 100,
        totalOutputTokens: 20,
        totalTokens: 120,
      },
      operationId: 'op-codex',
    });

    const events = await pipeline.push(
      `${JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 180,
          output_tokens: 45,
        },
      })}\n`,
    );

    expect(events[0]).toMatchObject({
      data: {
        phase: 'turn_metadata',
        provider: 'codex',
        usage: {
          inputCacheMissTokens: 80,
          totalInputTokens: 80,
          totalOutputTokens: 25,
          totalTokens: 105,
        },
      },
      operationId: 'op-codex',
      type: 'step_complete',
    });
  });

  it('drops non-JSON noise lines instead of throwing', async () => {
    const pipeline = new AgentStreamPipeline({
      agentType: 'claude-code',
      operationId: 'op-1',
    });

    const events = await pipeline.push(`not-json-line\n${init()}`);

    expect(pipeline.sessionId).toBe('cc-1');
    expect(events.length).toBeGreaterThan(0);
  });

  it('flushes adapter-buffered events on stream end', async () => {
    const pipeline = new AgentStreamPipeline({
      agentType: 'claude-code',
      operationId: 'op-1',
    });

    await pipeline.push(init());
    const flushed = await pipeline.flush();

    expect(Array.isArray(flushed)).toBe(true);
  });

  describe('tool_result image upload ()', () => {
    it('rewrites base64 pluginState.images into uploaded references', async () => {
      const uploadImage = vi
        .fn()
        .mockResolvedValue({ fileId: 'file_1', url: 'https://cdn/x.png' });
      const pipeline = new AgentStreamPipeline({
        agentType: 'claude-code',
        operationId: 'op-1',
        uploadImage,
      });

      const events = await pipeline.push(init() + ccReadImage());

      expect(uploadImage).toHaveBeenCalledWith({ data: 'AAAA', mediaType: 'image/png' });
      expect(imagesOf(events)).toEqual([
        { fileId: 'file_1', mediaType: 'image/png', url: 'https://cdn/x.png' },
      ]);
      // Base64 body must never survive into the persisted event.
      expect(imagesOf(events)![0]).not.toHaveProperty('data');
      // The `[Image: …]` placeholder is rewritten to a markdown image so a
      // downstream model knows an image is here (and where).
      expect(contentOf(events)).toBe('![image/png](https://cdn/x.png)');
    });

    it('drops the image when no uploader is injected (base64 never persisted)', async () => {
      const pipeline = new AgentStreamPipeline({
        agentType: 'claude-code',
        operationId: 'op-1',
      });

      const events = await pipeline.push(init() + ccReadImage());

      expect(imagesOf(events)).toBeUndefined();
    });

    it('drops the image and keeps streaming when the uploader throws', async () => {
      const uploadImage = vi.fn().mockRejectedValue(new Error('boom'));
      const pipeline = new AgentStreamPipeline({
        agentType: 'claude-code',
        operationId: 'op-1',
        uploadImage,
      });

      const events = await pipeline.push(init() + ccReadImage());

      expect(uploadImage).toHaveBeenCalledTimes(1);
      expect(imagesOf(events)).toBeUndefined();
      // The `[Image: …]` placeholder is still the content fallback.
      expect(events.find((e) => e.type === 'tool_result')?.data?.content).toBe('[Image: image/png]');
    });

    it('drops the image when the uploader declines (returns undefined)', async () => {
      const uploadImage = vi.fn().mockResolvedValue(undefined);
      const pipeline = new AgentStreamPipeline({
        agentType: 'claude-code',
        operationId: 'op-1',
        uploadImage,
      });

      const events = await pipeline.push(init() + ccReadImage());

      expect(imagesOf(events)).toBeUndefined();
    });
  });
});
