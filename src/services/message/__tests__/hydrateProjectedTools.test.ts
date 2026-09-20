import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { hydrateProjectedToolMessages } from '../hydrateProjectedTools';

const msg = (over: Partial<UIChatMessage>): UIChatMessage =>
  ({ content: '', createdAt: 1_780_000_000_000, id: 'm', role: 'user', ...over }) as UIChatMessage;

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
    const [replayed] = hydrated ?? [];

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
