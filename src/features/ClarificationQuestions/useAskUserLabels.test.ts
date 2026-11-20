/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAskUserLabels } from './useAskUserLabels';

const i18n = vi.hoisted(() => ({ ready: true as boolean | undefined }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ ready: i18n.ready, t: (key: string) => `t:${key}` }),
}));

describe('useAskUserLabels', () => {
  beforeEach(() => {
    i18n.ready = true;
  });

  it('withholds the labels until the namespace has loaded, so no raw key is shown', () => {
    i18n.ready = false;
    expect(renderHook(() => useAskUserLabels({})).result.current).toBeUndefined();
  });

  it('uses the host wording for the two footer buttons', () => {
    const labels = renderHook(() => useAskUserLabels({ skip: 'Skip and create', submit: 'Create' }))
      .result.current!;

    expect(labels.skip).toBe('Skip and create');
    expect(labels.submit).toBe('Create');
    expect(labels.customPlaceholder).toBe('t:askUserQuestion.customOption.placeholder');
  });
});
