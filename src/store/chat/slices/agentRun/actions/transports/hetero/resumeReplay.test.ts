import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildResumeReplayMessages } from './resumeReplay';

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
