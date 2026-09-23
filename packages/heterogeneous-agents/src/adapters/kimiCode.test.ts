import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { KimiCodeAdapter } from './kimiCode';

const tempDirs: string[] = [];

const makeTempKimiHome = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lobe-kimi-adapter-'));
  tempDirs.push(dir);
  return dir;
};

const writeWireLog = async (
  kimiHome: string,
  sessionId: string,
  usageRecords: { model?: string; usage: Record<string, number> }[],
) => {
  const dir = path.join(kimiHome, 'sessions', 'wd_test', sessionId, 'agents', 'main');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'wire.jsonl'),
    usageRecords
      .map(({ model, usage }) =>
        JSON.stringify({ agentId: 'main', model, type: 'usage.record', usage }),
      )
      .join('\n'),
  );
};

describe('KimiCodeAdapter', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it('maps the documented text, parallel tools, results, and resume hint sequence', () => {
    const adapter = new KimiCodeAdapter();
    const first = adapter.adapt({
      content: 'Checking.',
      role: 'assistant',
      tool_calls: [
        {
          function: { arguments: '{"path":"a"}', name: 'read_file' },
          id: 'call-1',
          type: 'function',
        },
        { function: { arguments: '{}', name: 'list_files' }, id: 'call-2', type: 'function' },
      ],
    });
    expect(first.map((event) => event.type)).toEqual([
      'stream_start',
      'stream_chunk',
      'stream_chunk',
    ]);
    expect(first[2].data.toolsCalling).toHaveLength(2);

    const firstResult = adapter.adapt({
      content: 'contents',
      role: 'tool',
      tool_call_id: 'call-1',
    });
    expect(firstResult.map((event) => event.type)).toEqual(['tool_result', 'tool_end']);
    expect(firstResult.every((event) => event.stepIndex === 0)).toBe(true);
    expect(firstResult[1].data).toMatchObject({
      payload: {
        toolCalling: {
          apiName: 'read_file',
          identifier: 'kimi-code',
        },
      },
      result: { content: 'contents', success: true },
    });
    expect(adapter.adapt({ content: 'duplicate', role: 'tool', tool_call_id: 'call-1' })).toEqual(
      [],
    );
    expect(adapter.adapt({ content: 'orphan', role: 'tool', tool_call_id: 'missing' })).toEqual([]);
    expect(
      adapter
        .adapt({ content: ['a', 'b'], role: 'tool', tool_call_id: 'call-2' })
        .map((event) => event.type),
    ).toEqual(['tool_result', 'tool_end']);

    const second = adapter.adapt({ content: 'Done.', role: 'assistant' });
    expect(second.map((event) => event.type)).toEqual([
      'stream_end',
      'stream_start',
      'stream_chunk',
    ]);
    expect(second[1]).toMatchObject({ data: { newStep: true }, stepIndex: 1 });

    expect(
      adapter.adapt({ role: 'meta', session_id: 'session-1', type: 'session.resume_hint' }),
    ).toEqual([]);
    expect(adapter.sessionId).toBe('session-1');
    expect(adapter.flush().map((event) => event.type)).toEqual(['stream_end']);
    expect(adapter.flush()).toEqual([]);
  });

  it('keeps assistant records in one step until a tool result creates an inferable boundary', () => {
    const adapter = new KimiCodeAdapter();
    expect(
      adapter.adapt({ content: 'Hook output.', role: 'assistant' }).map((e) => e.type),
    ).toEqual(['stream_start', 'stream_chunk']);
    expect(
      adapter.adapt({ content: 'Main output.', role: 'assistant' }).map((e) => e.type),
    ).toEqual(['stream_chunk']);

    const firstTool = adapter.adapt({
      role: 'assistant',
      tool_calls: [{ function: { arguments: '{}', name: 'Read' }, id: 'call-1', type: 'function' }],
    });
    expect(firstTool[0].data.toolsCalling).toHaveLength(1);
    const secondTool = adapter.adapt({
      role: 'assistant',
      tool_calls: [
        { function: { arguments: '{}', name: 'Shell' }, id: 'call-2', type: 'function' },
      ],
    });
    expect(secondTool[0].data.toolsCalling.map((call: any) => call.id)).toEqual([
      'call-1',
      'call-2',
    ]);
  });

  it('maps retry metadata and settles tools left pending at EOF exactly once', () => {
    const adapter = new KimiCodeAdapter();
    adapter.adapt({
      role: 'assistant',
      tool_calls: [
        { function: { arguments: '{}', name: 'list_files' }, id: 'call-1', type: 'function' },
      ],
    });

    const retry = adapter.adapt({
      delay_ms: 500,
      error_message: 'busy',
      error_name: 'HTTPError',
      failed_attempt: 1,
      max_attempts: 3,
      next_attempt: 2,
      role: 'meta',
      status_code: 503,
      type: 'turn.step.retrying',
    });
    expect(retry[0]).toMatchObject({
      data: { attempt: 2, delayMs: 500, maxAttempts: 3, provider: 'kimi-code', statusCode: 503 },
      type: 'stream_retry',
    });

    const flushed = adapter.flush();
    expect(flushed.map((event) => event.type)).toEqual(['tool_result', 'tool_end', 'stream_end']);
    expect(flushed[0].data).toMatchObject({ isError: true, toolCallId: 'call-1' });
    expect(flushed[1].data).toMatchObject({
      payload: { toolCalling: { identifier: 'kimi-code' } },
      result: { success: false },
    });
    expect(adapter.flush()).toEqual([]);
  });

  it('ignores malformed input', () => {
    const adapter = new KimiCodeAdapter();
    expect(adapter.adapt(null)).toEqual([]);
    expect(adapter.adapt('bad')).toEqual([]);
    expect(adapter.adapt({ role: 'assistant', tool_calls: [{ id: 3 }] })).toEqual([]);
    expect(adapter.adapt({ role: 'meta', type: 'system.version', version: '0.28.0' })).toEqual([]);
    expect(adapter.adapt({ status: 'complete', type: 'goal.summary' })).toEqual([]);
  });

  describe('collectPostRunUsage', () => {
    it('emits aggregated wire-log usage as a turn_metadata step_complete on the last step', async () => {
      const kimiHome = await makeTempKimiHome();
      const adapter = new KimiCodeAdapter();
      adapter.adapt({ role: 'meta', session_id: 'session-1', type: 'session.resume_hint' });
      // Two steps, so the usage event must land on stepIndex 1.
      adapter.adapt({
        role: 'assistant',
        tool_calls: [
          { function: { arguments: '{}', name: 'Read' }, id: 'call-1', type: 'function' },
        ],
      });
      adapter.adapt({ content: 'contents', role: 'tool', tool_call_id: 'call-1' });
      adapter.adapt({ content: 'Done.', role: 'assistant' });
      await writeWireLog(kimiHome, 'session-1', [
        { model: 'kimi-code/k3', usage: { inputCacheRead: 22_784, inputOther: 225, output: 27 } },
        { model: 'kimi-code/k3', usage: { inputCacheCreation: 10, inputOther: 100, output: 53 } },
      ]);

      const events = await adapter.collectPostRunUsage({ env: { KIMI_CODE_HOME: kimiHome } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        data: {
          model: 'kimi-k3',
          phase: 'turn_metadata',
          provider: 'kimi-code',
          usage: {
            inputCacheMissTokens: 325,
            inputCachedTokens: 22_784,
            inputWriteCacheTokens: 10,
            totalInputTokens: 23_119,
            totalOutputTokens: 80,
            totalTokens: 23_199,
          },
        },
        stepIndex: 1,
        type: 'step_complete',
      });
    });

    it('omits the model from the event when the wire log does not record one', async () => {
      const kimiHome = await makeTempKimiHome();
      const adapter = new KimiCodeAdapter();
      adapter.adapt({ role: 'meta', session_id: 'session-2', type: 'session.resume_hint' });
      await writeWireLog(kimiHome, 'session-2', [{ usage: { inputOther: 7, output: 3 } }]);

      const events = await adapter.collectPostRunUsage({ env: { KIMI_CODE_HOME: kimiHome } });
      expect(events).toHaveLength(1);
      expect(events[0].data).not.toHaveProperty('model');
      expect(events[0]).toMatchObject({
        data: { phase: 'turn_metadata', usage: { totalTokens: 10 } },
        type: 'step_complete',
      });
    });

    it('no-ops without a session id or wire log', async () => {
      const kimiHome = await makeTempKimiHome();

      const noSession = new KimiCodeAdapter();
      await expect(
        noSession.collectPostRunUsage({ env: { KIMI_CODE_HOME: kimiHome } }),
      ).resolves.toEqual([]);

      const missingLog = new KimiCodeAdapter();
      missingLog.adapt({ role: 'meta', session_id: 'nope', type: 'session.resume_hint' });
      await expect(
        missingLog.collectPostRunUsage({ env: { KIMI_CODE_HOME: kimiHome } }),
      ).resolves.toEqual([]);
    });
  });
});
