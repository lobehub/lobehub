import { describe, expect, it, vi } from 'vitest';

import { privatizeTasks } from './privatizeTasks';

vi.mock('@/services/task', () => ({ taskService: { updateVisibility: vi.fn() } }));

describe('privatizeTasks', () => {
  it('makes each task private, taking over teammates’ tasks, and counts failures', async () => {
    const update = vi.fn(async (id: string) => {
      if (id === 'locked') throw new Error('Task is being edited by another user');
    });

    const { failed } = await privatizeTasks(
      [
        { id: 'own', takeOwnership: false },
        { id: 'theirs', takeOwnership: true },
        { id: 'locked', takeOwnership: false },
      ],
      update as never,
    );

    expect(update).toHaveBeenCalledWith('own', 'private');
    expect(update).toHaveBeenCalledWith('theirs', 'private', { takeOwnership: true });
    expect(failed).toEqual(['locked']);
  });

  it('keeps at most five visibility changes in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const update = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
    });

    await privatizeTasks(
      Array.from({ length: 12 }, (_, index) => ({ id: `t${index}`, takeOwnership: false })),
      update as never,
    );

    expect(update).toHaveBeenCalledTimes(12);
    expect(peak).toBe(5);
  });
});
