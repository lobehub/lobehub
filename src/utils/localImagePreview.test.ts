import { describe, expect, it } from 'vitest';

import { getLocalImagePreview, rememberLocalImagePreview } from './localImagePreview';

describe('localImagePreview', () => {
  it('returns the local copy remembered for an uploaded file', () => {
    rememberLocalImagePreview('file-1', 'blob:a');

    expect(getLocalImagePreview('file-1')).toBe('blob:a');
    expect(getLocalImagePreview('file-2')).toBeUndefined();
  });
});
