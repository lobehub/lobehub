import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useExperimentViewState } from './useExperimentViewState';

describe('useExperimentViewState', () => {
  it('resets the selected part and case filters when another experiment opens', () => {
    const { result, rerender } = renderHook(({ id }) => useExperimentViewState(id), {
      initialProps: { id: 'experiment-a' },
    });
    act(() => {
      result.current.setPartIndex(2);
      result.current.setFilter('allFail');
      result.current.setCategory('Tools');
      result.current.setLevel('L3');
      result.current.setOpenCase('case-1');
    });
    expect(result.current.partIndex).toBe(2);

    rerender({ id: 'experiment-b' });

    expect(result.current).toMatchObject({
      category: undefined,
      filterOverride: undefined,
      level: undefined,
      openCase: undefined,
      partIndex: 0,
    });
  });

  it('keeps the choices while the same experiment re-renders', () => {
    const { result, rerender } = renderHook(({ id }) => useExperimentViewState(id), {
      initialProps: { id: 'experiment-a' },
    });
    act(() => result.current.setPartIndex(1));
    rerender({ id: 'experiment-a' });
    expect(result.current.partIndex).toBe(1);
  });
});
