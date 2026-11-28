import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { HeterogeneousAgentEvent } from '../types';
import { DoubaoAdapter } from './doubao';

/**
 * Ndjson captured on this machine from `doubao` 2.38.2:
 *
 *   doubao -p - --output-format stream-json --permission-mode always_allow < p.txt
 *
 * One `Bash` round-trip followed by the answer. Keep the bytes verbatim: the
 * shapes this adapter depends on — namespaced tool ids, the bare response id
 * on the `stream_event` wrapper, `result.result` as an object, array
 * `tool_result.content` — only stay honest if nobody tidies them up.
 */
const readFrames = async (name: string): Promise<any[]> => {
  const raw = await readFile(new URL(`./__fixtures__/doubao/${name}`, import.meta.url), 'utf8');

  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
};

const replay = (frames: any[]): HeterogeneousAgentEvent[] => {
  const adapter = new DoubaoAdapter();

  return frames.flatMap((frame) => adapter.adapt(frame));
};

const textOf = (events: HeterogeneousAgentEvent[]): string =>
  events
    .filter((event) => event.type === 'stream_chunk' && event.data.chunkType === 'text')
    .map((event) => event.data.content)
    .join('');

/** The answer Doubao streamed delta-by-delta and then echoed in one block. */
const ANSWER = "当前目录是 `/tmp/dbtest`，里面有 3 个文件：\n\n- `err.log`（3.2 KB）\n- `out.jsonl`（485 字节）\n- `p.txt`（63 字节）\n\n一共 **3** 个文件，没有子目录。";

describe('DoubaoAdapter', () => {
  it('replays one tool round-trip and emits the answer exactly once', async () => {
    const events = replay(await readFrames('tool-round-trip.jsonl'));

    // Doubao sends no `message_start`, so the delta flow gets its id from the
    // wrapper. Without it the trailing full-text `assistant` echo is persisted
    // as a second copy of the whole answer.
    expect(textOf(events)).toBe(ANSWER);

    // The answer is its own assistant: the deltas open a step, while the
    // tool_use frame only records the turn's namespaced item id.
    const newSteps = events.filter((event) => event.type === 'stream_start' && event.data.newStep);
    expect(newSteps).toHaveLength(1);
    expect(newSteps[0]?.data.messageId).toBe('63056907842005506');

    // `tool_result.content` is an array of `{type: 'text', text}` blocks here,
    // not the string Claude sends.
    const toolResult = events.find((event) => event.type === 'tool_result');
    expect(toolResult?.data.isError).toBe(false);
    expect(toolResult?.data.content).toContain("Command 'ls -la /tmp/dbtest");

    expect(events.filter((event) => event.type === 'tool_start')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool_end')[0]?.data.isSuccess).toBe(true);
  });

  it('turns a longer echo into the suffix the deltas never carried', async () => {
    const frames = await readFrames('tool-round-trip.jsonl');
    // Drop the last delta: its text then only exists on the echo. The base
    // class must emit that tail, not drop it and not repeat the prefix.
    const lastDelta = frames.map((frame) => frame.type).lastIndexOf('stream_event');
    const events = replay(frames.filter((_, index) => index !== lastDelta));

    expect(textOf(events)).toBe(ANSWER);
  });

  it('unwraps an object result so auth classification reads the real text', async () => {
    const adapter = new DoubaoAdapter();
    adapter.adapt({ session_id: 'doubao-auth', subtype: 'init', type: 'system' });

    const events = adapter.adapt({
      is_error: true,
      message_id: '63056907842005506',
      result: { content: 'auth_unavailable: 无法访问用于保存设备身份的安全存储', type: 'text' },
      session_id: 'doubao-auth',
      subtype: 'success',
      type: 'result',
    });

    expect(events.map((event) => event.type)).toEqual([
      'stream_end',
      'visible_output_end',
      'error',
    ]);
    expect(events.at(-1)?.data).toMatchObject({
      agentType: 'doubao',
      clearEchoedContent: true,
      code: 'auth_required',
    });
    // Not JSON, and not the descriptor's canned sentence.
    expect(events.at(-1)?.data.error).toBe(
      'auth_unavailable: 无法访问用于保存设备身份的安全存储',
    );
  });
});
