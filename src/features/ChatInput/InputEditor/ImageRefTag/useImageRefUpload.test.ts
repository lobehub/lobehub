/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useImageRefUpload } from './useImageRefUpload';

describe('useImageRefUpload', () => {
  // Regression: the reference loads in every editor built from the chat input plugins,
  // such as the modal for editing a sent message, which has no chat input store above it.
  it('finds no upload outside a chat input instead of throwing', () => {
    const { result } = renderHook(() => useImageRefUpload('blob:gone'));

    expect(result.current).toEqual({ number: undefined, upload: undefined });
  });
});
