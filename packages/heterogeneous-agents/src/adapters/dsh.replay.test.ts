import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { HeterogeneousAgentEvent } from '../types';
import { DshAdapter } from './dsh';

/**
 * Replays the DeepSeek Harness runtime's OWN recorded notification streams.
 *
 * `__fixtures__/dsh/recorded/*.jsonl` are copied verbatim from the harness repo
 * (`examples/jsonrpc-agent/tests/snapshots/<case>/notifications.expected.jsonl`)
 * — real frames from real runs, not hand-authored. They are the contract this
 * adapter is written against, and they caught defects hand-written fixtures did
 * not: `stream_start` firing before the route was logged, spawn metadata
 * consumed by a lifecycle frame that maps to no event, and a false terminal
 * error on a retried request.
 *
 * Refresh them by re-copying from the harness repo when its protocol moves; the
 * harness carries no pre-release compatibility promise, so a diff here is the
 * intended early warning.
 */

const load = async (name: string): Promise<any[]> => {
  const jsonl = await readFile(
    new URL(`./__fixtures__/dsh/recorded/${name}.jsonl`, import.meta.url),
    'utf8',
  );
  return jsonl
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
};

const replay = (frames: any[]): HeterogeneousAgentEvent[] => {
  const adapter = new DshAdapter();
  const events = frames.flatMap((frame) => adapter.adapt(frame));
  events.push(...adapter.flush());
  return events;
};

/** Event types minus the token-level chunks, which are asserted by count. */
const shape = (events: HeterogeneousAgentEvent[]): string[] =>
  events
    .filter(
      (event) => event.type !== 'stream_chunk' || (event.data as any).chunkType === 'tools_calling',
    )
    .map((event) => (event.type === 'stream_chunk' ? 'stream_chunk:tools_calling' : event.type));

const countOf = (events: HeterogeneousAgentEvent[], type: string): number =>
  events.filter((event) => event.type === type).length;

describe('DshAdapter — recorded harness streams', () => {
  it('maps a plain text turn', async () => {
    const events = replay(await load('text-turn'));

    expect(shape(events)).toEqual([
      'stream_start',
      'stream_end',
      'step_complete',
      'visible_output_end',
      'agent_runtime_end',
    ]);
    // The route is logged in `request/header` INSIDE the step, after
    // `step/start` — a stream opened eagerly reports no model.
    expect(events[0].data).toMatchObject({
      model: 'deepseek-v4-flash',
      provider: 'deepseek-harness',
    });
    // Token-level deltas cross as separate reasoning and text chunks, and
    // reassemble into exactly what the model produced.
    const assemble = (chunkType: string, field: 'content' | 'reasoning') =>
      events
        .filter((e) => e.type === 'stream_chunk' && (e.data as any).chunkType === chunkType)
        .map((e) => (e.data as any)[field])
        .join('');

    expect(assemble('text', 'content')).toBe('SDK snapshot OK');
    expect(assemble('reasoning', 'reasoning')).toContain('SDK snapshot OK');
    expect(countOf(events, 'stream_chunk')).toBeGreaterThan(10);
  });

  it('maps a two-step bash turn with paired tool lifecycle', async () => {
    const events = replay(await load('bash-tool'));

    expect(shape(events)).toEqual([
      'stream_start',
      'stream_chunk:tools_calling',
      'stream_end',
      'step_complete',
      'tool_start',
      'tool_result',
      'tool_end',
      'stream_start',
      'stream_end',
      'step_complete',
      'visible_output_end',
      'agent_runtime_end',
    ]);
    expect(events.filter((e) => e.type === 'stream_start').map((e) => e.stepIndex)).toEqual([0, 1]);

    const result = events.find((e) => e.type === 'tool_result');
    expect(result?.data).toMatchObject({ content: 'dsh-sdk-proof-7391\n' });
  });

  it('keeps tool calls paired across seven steps of mixed tools', async () => {
    const events = replay(await load('persistent-tools'));

    expect(countOf(events, 'stream_start')).toBe(7);
    expect(countOf(events, 'stream_end')).toBe(7);
    expect(countOf(events, 'tool_start')).toBe(6);
    expect(countOf(events, 'tool_result')).toBe(6);
    expect(countOf(events, 'tool_end')).toBe(6);
    expect(Math.max(...events.map((e) => e.stepIndex))).toBe(6);

    const toolCalls = events
      .filter((e) => e.type === 'tool_start')
      .map((e) => (e.data as any).toolCalling);
    expect(new Set(toolCalls.map(({ identifier }) => identifier))).toEqual(
      new Set(['deepseek-harness']),
    );
    expect(new Set(toolCalls.map(({ apiName }) => apiName))).toEqual(
      new Set(['bash', 'str_replace_editor']),
    );

    // A non-zero shell exit is a completed tool call, not a failed one: the
    // harness reports a tool error separately from the command's exit code.
    expect(
      events.filter((e) => e.type === 'tool_end').every((e) => (e.data as any).isSuccess),
    ).toBe(true);
  });

  it('routes a delegated child session to its spawning tool call', async () => {
    // The recorded snapshots normalize EVERY session id to `{{sessionId}}`,
    // which collapses parent and child into one session. Rebuild the real
    // topology by re-stamping the frames between the subagent start and finish.
    const frames = await load('subagent-spawn');
    let inChild = false;
    for (const frame of frames) {
      const params = frame.params ?? {};
      if (frame.method === 'subagent.started') {
        params.parentSessionId = 'root';
        params.childSessionId = 'child';
        inChild = true;
        continue;
      }
      if (frame.method === 'subagent.finished') {
        params.parentSessionId = 'root';
        params.childSessionId = 'child';
        inChild = false;
        continue;
      }
      if (params.sessionId) params.sessionId = inChild ? 'child' : 'root';
    }

    const events = replay(frames);
    const stamped = events.filter((e) => (e.data as any).subagent);

    expect(stamped.length).toBeGreaterThan(0);
    const parentToolCallId = (stamped[0].data as any).subagent.parentToolCallId;
    expect(
      stamped.every((e) => (e.data as any).subagent.parentToolCallId === parentToolCallId),
    ).toBe(true);

    // Spawn metadata rides the first EMITTED child event exactly once. The
    // child opens with lifecycle frames that map to nothing; if those consume
    // it, the executor never gets what it needs to open the child Thread.
    const withSpawn = stamped.filter((e) => (e.data as any).subagent.spawnMetadata);
    expect(withSpawn).toHaveLength(1);
    expect(withSpawn[0]).toBe(stamped[0]);
    expect((withSpawn[0].data as any).subagent.spawnMetadata).toEqual({
      // The child's own `subagent/descriptor` label, not the delegating tool name.
      description: 'echo probe',
      prompt: 'Reply with exactly: child answer 42.',
    });

    // The child's text must not leak into the parent's assistant message.
    const childText = stamped
      .filter((e) => (e.data as any).chunkType === 'text')
      .map((e) => (e.data as any).content)
      .join('');
    expect(childText).toBe('child answer 42.');

    // A subagent step stays inside the parent's step.
    expect(countOf(events, 'stream_start')).toBe(2);
  });

  it('never emits a terminal error for a healthy recorded run', async () => {
    for (const name of ['text-turn', 'bash-tool', 'persistent-tools', 'subagent-spawn']) {
      const events = replay(await load(name));
      expect({ name, errors: countOf(events, 'error') }).toEqual({ name, errors: 0 });
      // Every run reaches exactly one terminal boundary.
      expect({ name, ends: countOf(events, 'agent_runtime_end') }).toEqual({ name, ends: 1 });
    }
  });

  it('leaves no stream unclosed and no tool call unpaired', async () => {
    for (const name of ['text-turn', 'bash-tool', 'persistent-tools', 'subagent-spawn']) {
      const events = replay(await load(name));
      expect({ name, starts: countOf(events, 'stream_start') }).toEqual({
        name,
        starts: countOf(events, 'stream_end'),
      });
      expect({ name, calls: countOf(events, 'tool_start') }).toEqual({
        name,
        calls: countOf(events, 'tool_end'),
      });
    }
  });
});
