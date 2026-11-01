import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDevelopsOnMount } from './useDevelopsOnMount';

const URL = 'https://example.com/image.png';

describe('useDevelopsOnMount', () => {
  it('skips the develop motion for a history image known at mount', () => {
    const { result } = renderHook(() => useDevelopsOnMount(URL));

    expect(result.current).toBe(false);
  });

  it('keeps the develop motion when the image lands after mount', () => {
    const { rerender, result } = renderHook(({ url }) => useDevelopsOnMount(url), {
      initialProps: { url: undefined as string | undefined },
    });

    rerender({ url: URL });

    expect(result.current).toBe(true);
  });

  it('keeps the develop motion when this session watched the generation start', () => {
    const { result } = renderHook(() => useDevelopsOnMount(URL, Date.now() - 1000));

    expect(result.current).toBe(true);
  });
});
