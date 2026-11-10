import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useGateOptionCopy } from '.';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key}${JSON.stringify(options)}` : key,
  }),
}));

describe('useGateOptionCopy', () => {
  it('names the dependents a retire takes along, worded by the client', () => {
    // The coordinator sends only the titles; English copy written by the
    // server showed up untranslated on a Chinese page.
    const { result } = renderHook(() => useGateOptionCopy());

    const copy = result.current.describe(
      {
        alsoRetires: [
          { nodeId: 'n1', title: 'Write summary' },
          { nodeId: 'n2', title: 'Publish' },
        ],
        id: 'retire',
        label: 'Retire task',
      },
      'machine',
    );

    expect(copy).toContain('goalProcess.decision.effect.retireWithDependents');
    expect(copy).toContain('goalProcess.decision.effect.quotedTask');
    expect(copy).toContain('Write summary');
    expect(copy).toContain('Publish');
  });

  it('keeps the plain retire copy when nothing depends on the task', () => {
    const { result } = renderHook(() => useGateOptionCopy());

    expect(result.current.describe({ id: 'retire', label: 'Retire task' }, 'judgment')).toBe(
      'goalProcess.decision.effect.retire',
    );
  });

  it('adds the cascade to an option the main Agent described itself', () => {
    const { result } = renderHook(() => useGateOptionCopy());

    const note = result.current.cascade({
      alsoRetires: [{ nodeId: 'n1', title: 'Write summary' }],
      description: 'Skip the measurement',
      effect: 'retire',
      id: 'skip',
      label: 'Skip it',
    });

    expect(note).toContain('goalProcess.decision.effect.alsoRetires');
    expect(note).toContain('Write summary');
    expect(result.current.cascade({ id: 'keep', label: 'Keep going' })).toBeUndefined();
  });
});
