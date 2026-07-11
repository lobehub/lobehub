import type { OnboardingSuggestedTask } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStarterTasks } from './useStarterTasks';

const mocks = vi.hoisted(() => ({
  createTasks: vi.fn(),
  getSuggestions: vi.fn(),
  toastError: vi.fn(),
  useClientDataSWR: vi.fn((): { data: OnboardingSuggestedTask[] | undefined } => ({
    data: undefined,
  })),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: mocks.useClientDataSWR,
}));

vi.mock('@/services/onboardingTasks', () => ({
  onboardingTasksService: {
    createTasks: mocks.createTasks,
    getSuggestions: mocks.getSuggestions,
  },
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: mocks.toastError },
}));

const SUGGESTIONS: OnboardingSuggestedTask[] = [
  { checked: true, id: 'a', title: 'Draft a reply' },
  { checked: false, id: 'b', title: 'Recap study progress' },
];

beforeEach(() => {
  mocks.createTasks.mockReset().mockResolvedValue(undefined);
  mocks.getSuggestions.mockReset().mockResolvedValue(SUGGESTIONS);
  mocks.toastError.mockClear();
  mocks.useClientDataSWR.mockClear().mockReturnValue({ data: SUGGESTIONS });
});

describe('useStarterTasks', () => {
  it('initializes selection from the payload checked state', () => {
    const { result } = renderHook(() => useStarterTasks(vi.fn()));

    expect(result.current.rows).toEqual([
      { checked: true, id: 'a', title: 'Draft a reply' },
      { checked: false, id: 'b', title: 'Recap study progress' },
    ]);
    expect(result.current.selectedCount).toBe(1);
  });

  it('toggle() flips a single row without touching the rest', () => {
    const { result } = renderHook(() => useStarterTasks(vi.fn()));

    act(() => {
      result.current.toggle('b');
    });

    expect(result.current.selectedCount).toBe(2);

    act(() => {
      result.current.toggle('a');
    });

    expect(result.current.selectedCount).toBe(1);
    expect(result.current.rows.find((row) => row.id === 'a')?.checked).toBe(false);
  });

  it('submit() with N=0 just advances without calling createTasks', async () => {
    const onFinished = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useStarterTasks(onFinished));

    act(() => {
      result.current.toggle('a');
    });
    expect(result.current.selectedCount).toBe(0);

    await act(async () => {
      await result.current.submit();
    });

    expect(mocks.createTasks).not.toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('submit() with N=0 toasts and stays on the step when onFinished rejects', async () => {
    const onFinished = vi.fn().mockRejectedValue(new Error('not implemented'));
    const { result } = renderHook(() => useStarterTasks(onFinished));

    act(() => {
      result.current.toggle('a');
    });
    expect(result.current.selectedCount).toBe(0);

    await act(async () => {
      await result.current.submit();
    });

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(result.current.submitting).toBe(false);
  });

  it('submit() with N>0 calls createTasks with selected ids then advances', async () => {
    const onFinished = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useStarterTasks(onFinished));

    await act(async () => {
      await result.current.submit();
    });

    expect(mocks.createTasks).toHaveBeenCalledWith(['a']);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('submit() failure toasts and stays on the step', async () => {
    mocks.createTasks.mockRejectedValue(new Error('not implemented'));
    const onFinished = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useStarterTasks(onFinished));

    await act(async () => {
      await result.current.submit();
    });

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(onFinished).not.toHaveBeenCalled();
    expect(result.current.submitting).toBe(false);
  });

  it('is empty and never blocks finishing when the suggestions request errors', async () => {
    mocks.useClientDataSWR.mockReturnValue({ data: undefined });
    const onFinished = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useStarterTasks(onFinished));

    expect(result.current.rows).toEqual([]);
    expect(result.current.selectedCount).toBe(0);

    await act(async () => {
      await result.current.submit();
    });

    expect(mocks.createTasks).not.toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
