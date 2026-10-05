import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useJudgeDirections } from './useJudgeDirections';

const { judgeRuleDirections } = vi.hoisted(() => ({ judgeRuleDirections: vi.fn() }));
vi.mock('@/services/expertise', () => ({ expertiseService: { judgeRuleDirections } }));

const refresh = vi.fn(async () => {});

describe('useJudgeDirections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    judgeRuleDirections.mockResolvedValue({ judged: 1, remaining: 0 });
  });

  it('starts another pass for a rule written after the first pass began', async () => {
    const { rerender } = renderHook(({ ids }) => useJudgeDirections(true, ids, refresh), {
      initialProps: { ids: ['old'] },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    // A hand-written rule with no direction lands after the refresh.
    rerender({ ids: ['new'] });

    await waitFor(() => expect(judgeRuleDirections).toHaveBeenCalledTimes(2));
  });

  it('does not ask again about a rule the model keeps skipping', async () => {
    judgeRuleDirections.mockResolvedValue({ judged: 0, remaining: 1 });
    const { rerender } = renderHook(({ ids }) => useJudgeDirections(true, ids, refresh), {
      initialProps: { ids: ['skipped'] },
    });
    await waitFor(() => expect(judgeRuleDirections).toHaveBeenCalledTimes(1));

    rerender({ ids: ['skipped'] });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(judgeRuleDirections).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the lab is off', async () => {
    renderHook(() => useJudgeDirections(false, ['a'], refresh));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(judgeRuleDirections).not.toHaveBeenCalled();
  });
});
