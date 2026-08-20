import { renderHook } from '@testing-library/react';
import { EyeIcon, LockIcon, PlayIcon } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { useAccessLevelOptions } from './useAccessLevelOptions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('useAccessLevelOptions', () => {
  it('uses access and lock icons for knowledge-base visibility levels', () => {
    const { result } = renderHook(() =>
      useAccessLevelOptions({
        accessLevel: 'use',
        isPrivate: false,
        resourceType: 'knowledgeBase',
      }),
    );

    expect(result.current.map(({ icon, value }) => ({ icon, value }))).toEqual([
      { icon: EyeIcon, value: 'edit' },
      { icon: LockIcon, value: 'use' },
    ]);
  });

  it('keeps the non-knowledge-base use-level icon unchanged', () => {
    const { result } = renderHook(() =>
      useAccessLevelOptions({ accessLevel: 'use', isPrivate: false, resourceType: 'agent' }),
    );

    expect(result.current.find(({ value }) => value === 'use')?.icon).toBe(PlayIcon);
  });
});
