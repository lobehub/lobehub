import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useJudgeDirections } from './useJudgeDirections';

const { judgeRuleDirections } = vi.hoisted(() => ({ judgeRuleDirections: vi.fn() }));
vi.mock('@/services/expertise', () => ({ expertiseService: { judgeRuleDirections } }));

const refresh = vi.fn(async () => {});
const sleep = () => new Promise((resolve) => setTimeout(resolve, 20));
const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`);

describe('useJudgeDirections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    judgeRuleDirections.mockResolvedValue({ judged: 1 });
  });

  it('starts another call for a rule written after the first one began', async () => {
    const { rerender } = renderHook(({ list }) => useJudgeDirections(true, list, refresh), {
      initialProps: { list: ['old'] },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    // A hand-written rule with no direction lands after the refresh.
    rerender({ list: ['new'] });

    await waitFor(() => expect(judgeRuleDirections).toHaveBeenLastCalledWith(['new']));
  });

  it('works through every batch, however many rules there are', async () => {
    // Nothing is judged, so the list never shrinks: progress comes only from batching.
    judgeRuleDirections.mockResolvedValue({ judged: 0 });
    const all = ids('r', 450);
    renderHook(() => useJudgeDirections(true, all, refresh));

    await waitFor(() => expect(judgeRuleDirections).toHaveBeenCalledTimes(12));
    const sent = judgeRuleDirections.mock.calls.flatMap(([batch]) => batch);
    expect(sent).toEqual(all);
    expect(Math.max(...judgeRuleDirections.mock.calls.map(([batch]) => batch.length))).toBe(40);
  });

  it('never sends a rule the model skipped a second time', async () => {
    judgeRuleDirections.mockResolvedValue({ judged: 0 });
    const { rerender } = renderHook(({ list }) => useJudgeDirections(true, list, refresh), {
      initialProps: { list: ['skipped'] },
    });
    await waitFor(() => expect(judgeRuleDirections).toHaveBeenCalledTimes(1));

    rerender({ list: ['skipped'] });
    await sleep();

    expect(judgeRuleDirections).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the lab is off', async () => {
    renderHook(() => useJudgeDirections(false, ['a'], refresh));
    await sleep();

    expect(judgeRuleDirections).not.toHaveBeenCalled();
  });
});
