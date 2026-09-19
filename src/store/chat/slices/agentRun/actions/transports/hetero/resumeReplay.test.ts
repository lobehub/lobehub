import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  buildResumeReplayMessages,
  hydrateProjectedToolMessages,
  shouldHydrateResumeReplay,
} from './resumeReplay';

const msg = (over: Partial<UIChatMessage>): UIChatMessage =>
  ({ content: '', createdAt: 1_780_000_000_000, id: 'm', role: 'user', ...over }) as UIChatMessage;

describe('buildResumeReplayMessages', () => {
  it('maps user / assistant / tool turns into the transcript-rebuild shape', () => {
    const out = buildResumeReplayMessages([
      msg({ content: 'hi', id: 'u1', role: 'user' }),
      msg({
        content: 'reading',
        id: 'a1',
        role: 'assistant',
        tools: [
          {
            apiName: 'Read',
            arguments: '{"p":1}',
            id: 'toolu_1',
            identifier: 'claude-code',
            type: 'default',
          },
        ],
      } as Partial<UIChatMessage>),
      msg({ content: 'file body', id: 't1', role: 'tool', tool_call_id: 'toolu_1' }),
    ]);

    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(out[1].tools?.[0]).toMatchObject({ apiName: 'Read', id: 'toolu_1' });
    expect(out[2].toolCallId).toBe('toolu_1');
    expect(out[0].createdAt).toBe(new Date(1_780_000_000_000).toISOString());
  });

  it('skips virtual/grouping roles that carry no replayable turn', () => {
    const out = buildResumeReplayMessages([
      msg({ content: 'real', id: 'u1', role: 'user' }),
      msg({ content: 'grouped', id: 'g1', role: 'assistantGroup' as any }),
      msg({ content: 'sys', id: 's1', role: 'system' as any }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('real');
  });

  it('drops a tool turn with no tool_call_id (nothing to answer)', () => {
    const out = buildResumeReplayMessages([
      msg({ content: 'q', id: 'u1', role: 'user' }),
      msg({ content: 'orphan', id: 't1', role: 'tool' }),
    ]);
    expect(out.map((m) => m.role)).toEqual(['user']);
  });

  it('drops the in-flight prompt echo and the empty assistant placeholder', () => {
    const out = buildResumeReplayMessages(
      [
        msg({ content: 'older turn', id: 'u1', role: 'user' }),
        msg({ content: 'older reply', id: 'a1', role: 'assistant' }),
        msg({ content: 'new question', id: 'u2', role: 'user' }),
        msg({ content: '', id: 'a2', role: 'assistant' }),
      ],
      'new question',
    );
    // only the PREVIOUS turns survive — the new prompt is sent separately
    expect(out.map((m) => m.content)).toEqual(['older turn', 'older reply']);
  });

  it('returns an empty array for empty/undefined input', () => {
    expect(buildResumeReplayMessages(undefined)).toEqual([]);
    expect(buildResumeReplayMessages([])).toEqual([]);
  });
});

describe('hydrateProjectedToolMessages', () => {
  const projectedTool = (over: Partial<UIChatMessage> = {}) =>
    msg({
      content: '',
      contentLength: 9736,
      id: 't1',
      payloadOmitted: 'render',
      role: 'tool',
      tool_call_id: 'call_1',
      ...over,
    });

  it('restores a projected tool body before it is replayed into the transcript', async () => {
    // The regression: this transcript is written to disk and resumed from, so
    // replaying the emptied body persists "this tool returned nothing".
    const fetchStored = vi.fn().mockResolvedValue({ content: 'the real command output' });

    const hydrated = await hydrateProjectedToolMessages([projectedTool()], fetchStored);
    const [replayed] = buildResumeReplayMessages(hydrated);

    expect(fetchStored).toHaveBeenCalledWith('t1');
    expect(replayed).toMatchObject({ content: 'the real command output', role: 'tool' });
  });

  it('fetches nothing when no tool body was projected away', async () => {
    const fetchStored = vi.fn();
    const messages = [msg({ content: 'plain', id: 't2', role: 'tool', tool_call_id: 'c2' })];

    expect(await hydrateProjectedToolMessages(messages, fetchStored)).toBe(messages);
    expect(fetchStored).not.toHaveBeenCalled();
  });

  it('replays the trimmed body rather than losing the turn when the fetch fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStored = vi.fn().mockRejectedValue(new Error('offline'));

    const hydrated = await hydrateProjectedToolMessages([projectedTool()], fetchStored);

    expect(hydrated?.[0].content).toBe('');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('leaves every other message untouched', async () => {
    const user = msg({ content: 'hi', id: 'u1', role: 'user' });
    const fetchStored = vi.fn().mockResolvedValue({ content: 'out' });

    const hydrated = await hydrateProjectedToolMessages([user, projectedTool()], fetchStored);

    expect(hydrated?.[0]).toBe(user);
    expect(fetchStored).toHaveBeenCalledTimes(1);
  });
});

describe('shouldHydrateResumeReplay', () => {
  it('pays for a restored transcript only where one is actually rebuilt', () => {
    // Main rebuilds a transcript for Claude Code and nothing else; the other
    // adapters are handed the replay and ignore it, so restoring their bodies
    // would be one authenticated round trip per historical tool, every turn.
    expect(shouldHydrateResumeReplay('claude-code')).toBe(true);

    for (const other of ['codex', 'opencode', 'pi', 'droid', undefined]) {
      expect(shouldHydrateResumeReplay(other)).toBe(false);
    }
  });
});
