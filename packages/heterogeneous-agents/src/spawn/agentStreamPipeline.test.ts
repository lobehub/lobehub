import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentStreamPipeline } from './agentStreamPipeline';

const tempDirs: string[] = [];

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

const ccReadImage = (toolCallId = 'r1', data = 'AAAA') =>
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
          content: [{ source: { data, media_type: 'image/png', type: 'base64' }, type: 'image' }],
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
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it.each(['uploaded', 'unavailable', 'failed'])(
    'recovers only the current rollout images before stream end (%s)',
    async (upload) => {
      const codexHome = await mkdtemp(path.join(os.tmpdir(), 'codex-images-'));
      tempDirs.push(codexHome);
      const sessionDir = path.join(codexHome, 'sessions', '2026', '10', '08');
      await mkdir(sessionDir, { recursive: true });
      const oldTimestamp = new Date(Date.now() - 60_000).toISOString();
      const pipeline = new AgentStreamPipeline({
        agentType: 'codex',
        env: { CODEX_HOME: codexHome },
        operationId: 'op-images',
        uploadImage:
          upload === 'unavailable'
            ? undefined
            : async () => {
                if (upload === 'failed') throw new Error('Upload failed');
                return { fileId: 'file-dog', url: 'https://cdn/dog.png' };
              },
      });
      const timestamp = new Date().toISOString();
      const record = (type: string, payload: unknown, at = timestamp) =>
        JSON.stringify({ payload, timestamp: at, type });
      const output = (callId: string) => ({
        call_id: callId,
        output: [
          { text: 'Script completed', type: 'input_text' },
          { image_url: 'data:image/png;base64,AAAA', type: 'input_image' },
        ],
        type: 'custom_tool_call_output',
      });
      await writeFile(
        path.join(sessionDir, 'rollout-thread-images.jsonl'),
        [
          record('event_msg', { type: 'task_started' }, oldTimestamp),
          record('response_item', output('old-image'), oldTimestamp),
          record('event_msg', { type: 'task_started' }),
          record('response_item', {
            call_id: 'dog-image',
            input: 'generate a dog',
            name: 'exec',
            type: 'custom_tool_call',
          }),
          record('response_item', output('dog-image')),
        ].join('\n') + '\n',
      );
      const events = await pipeline.push(
        [
          { thread_id: 'thread-images', type: 'thread.started' },
          { type: 'turn.started' },
          { item: { id: 'reply', text: 'Done.', type: 'agent_message' }, type: 'item.completed' },
          { type: 'turn.completed' },
        ]
          .map((event) => JSON.stringify(event))
          .join('\n') + '\n',
      );
      const result = events.find(({ type }) => type === 'tool_result');
      expect(result?.data).toMatchObject({
        content: upload === 'uploaded' ? '![image/png](https://cdn/dog.png)' : '[Image: image/png]',
        toolCallId: 'dog-image',
      });
      expect(result?.data.pluginState.images).toEqual(
        upload === 'uploaded'
          ? [{ fileId: 'file-dog', mediaType: 'image/png', url: 'https://cdn/dog.png' }]
          : undefined,
      );
      expect(events.filter(({ type }) => type === 'tool_result')).toHaveLength(1);
      expect(events.findIndex(({ type }) => type === 'tool_result')).toBeLessThan(
        events.findIndex(({ data, type }) => type === 'stream_chunk' && data.chunkType === 'text'),
      );
      expect(JSON.stringify(events)).not.toContain('AAAA');
      expect((await pipeline.flush()).some(({ type }) => type === 'tool_result')).toBe(false);
    },
  );

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

  describe('collectPostRunUsage', () => {
    it('no-ops for adapters without a post-run usage hook', async () => {
      const pipeline = new AgentStreamPipeline({
        agentType: 'claude-code',
        operationId: 'op-1',
      });

      await expect(pipeline.collectPostRunUsage()).resolves.toEqual([]);
    });

    it('no-ops for Kimi Code when the run has no session id or no wire log', async () => {
      const kimiHome = await mkdtemp(path.join(os.tmpdir(), 'lobe-kimi-pipeline-'));
      tempDirs.push(kimiHome);

      const noSession = new AgentStreamPipeline({ agentType: 'kimi-code', operationId: 'op-1' });
      await expect(
        noSession.collectPostRunUsage({ env: { KIMI_CODE_HOME: kimiHome } }),
      ).resolves.toEqual([]);

      const missingLog = new AgentStreamPipeline({ agentType: 'kimi-code', operationId: 'op-2' });
      await missingLog.push(
        `${JSON.stringify({ role: 'meta', session_id: 'nope', type: 'session.resume_hint' })}\n`,
      );
      await expect(
        missingLog.collectPostRunUsage({ env: { KIMI_CODE_HOME: kimiHome } }),
      ).resolves.toEqual([]);
    });

    it('emits Kimi Code wire-log usage as an operationId-stamped turn_metadata event', async () => {
      const kimiHome = await mkdtemp(path.join(os.tmpdir(), 'lobe-kimi-pipeline-'));
      tempDirs.push(kimiHome);
      const wireDir = path.join(kimiHome, 'sessions', 'wd_test', 'session-9', 'agents', 'main');
      await mkdir(wireDir, { recursive: true });
      await writeFile(
        path.join(wireDir, 'wire.jsonl'),
        `${JSON.stringify({
          agentId: 'main',
          model: 'kimi-code/k3',
          time: 1_700_000_000_000,
          type: 'usage.record',
          usage: { inputCacheRead: 1000, inputOther: 200, output: 50 },
        })}\n`,
      );

      const pipeline = new AgentStreamPipeline({
        agentType: 'kimi-code',
        operationId: 'op-kimi',
      });
      await pipeline.push(
        `${JSON.stringify({ role: 'meta', session_id: 'session-9', type: 'session.resume_hint' })}\n`,
      );

      const events = await pipeline.collectPostRunUsage({ env: { KIMI_CODE_HOME: kimiHome } });

      expect(events).toEqual([
        expect.objectContaining({
          data: {
            model: 'kimi-k3',
            phase: 'turn_metadata',
            provider: 'kimi-code',
            usage: {
              inputCacheMissTokens: 200,
              inputCachedTokens: 1000,
              inputWriteCacheTokens: undefined,
              totalInputTokens: 1200,
              totalOutputTokens: 50,
              totalTokens: 1250,
            },
          },
          operationId: 'op-kimi',
          stepIndex: 0,
          type: 'step_complete',
        }),
      ]);
    });
  });

  describe('tool_result image upload ()', () => {
    it('rewrites base64 pluginState.images into uploaded references', async () => {
      const uploadImage = vi.fn().mockResolvedValue({ fileId: 'file_1', url: 'https://cdn/x.png' });
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

    it('records the intrinsic size so renders can reserve the image box before it loads', async () => {
      // Minimal PNG header: signature + IHDR declaring 1280×800.
      const png = Buffer.alloc(24);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
      png.write('IHDR', 12, 'ascii');
      png.writeUInt32BE(1280, 16);
      png.writeUInt32BE(800, 20);
      const data = png.toString('base64');

      const uploadImage = vi.fn().mockResolvedValue({ fileId: 'file_1', url: 'https://cdn/x.png' });
      const pipeline = new AgentStreamPipeline({
        agentType: 'claude-code',
        operationId: 'op-1',
        uploadImage,
      });

      const events = await pipeline.push(init() + ccReadImage('r1', data));

      expect(uploadImage).toHaveBeenCalledWith({
        data,
        height: 800,
        mediaType: 'image/png',
        width: 1280,
      });
      expect(imagesOf(events)).toEqual([
        {
          fileId: 'file_1',
          height: 800,
          mediaType: 'image/png',
          url: 'https://cdn/x.png',
          width: 1280,
        },
      ]);
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
      expect(events.find((e) => e.type === 'tool_result')?.data?.content).toBe(
        '[Image: image/png]',
      );
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
