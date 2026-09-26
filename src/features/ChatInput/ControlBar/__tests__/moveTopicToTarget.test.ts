import { describe, expect, it, vi } from 'vitest';

import { moveTopicToTarget } from '../moveTopicToTarget';

describe('moveTopicToTarget', () => {
  it('keeps the topic untouched when the target is not saved', async () => {
    const repinTopic = vi.fn().mockResolvedValue(undefined);
    const afterRepin = vi.fn().mockResolvedValue(undefined);

    const result = await moveTopicToTarget({
      afterRepin,
      repinTopic,
      saveTarget: vi.fn().mockResolvedValue(false),
    });

    expect(result).toBe('target-not-saved');
    expect(repinTopic).not.toHaveBeenCalled();
    expect(afterRepin).not.toHaveBeenCalled();
  });

  it('saves the target before re-pinning the topic', async () => {
    const calls: string[] = [];

    const result = await moveTopicToTarget({
      afterRepin: async () => {
        calls.push('afterRepin');
      },
      repinTopic: async () => {
        calls.push('repinTopic');
      },
      saveTarget: async () => {
        calls.push('saveTarget');
        return true;
      },
    });

    expect(result).toBe('moved');
    expect(calls).toEqual(['saveTarget', 'repinTopic', 'afterRepin']);
  });

  it('reports a failed re-pin without running the follow-up', async () => {
    const afterRepin = vi.fn().mockResolvedValue(undefined);

    const result = await moveTopicToTarget({
      afterRepin,
      repinTopic: vi.fn().mockRejectedValue(new Error('network')),
      saveTarget: vi.fn().mockResolvedValue(true),
    });

    expect(result).toBe('topic-not-saved');
    expect(afterRepin).not.toHaveBeenCalled();
  });
});
