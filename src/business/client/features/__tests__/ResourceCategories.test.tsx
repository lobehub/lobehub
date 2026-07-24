import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useBusinessResourceCategories } from '../ResourceCategories';

describe('useBusinessResourceCategories (OSS stub)', () => {
  it('returns an empty array', () => {
    const { result } = renderHook(() => useBusinessResourceCategories());
    expect(result.current).toEqual([]);
  });
});
