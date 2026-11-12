import { afterEach, describe, expect, it } from 'vitest';

import {
  clearLocalMediaPreviews,
  rememberLocalMediaPreview,
  withLocalMediaPreview,
} from '../localMediaPreview';

describe('withLocalMediaPreview', () => {
  afterEach(() => clearLocalMediaPreviews());

  it('swaps a remembered file to its local preview', () => {
    rememberLocalMediaPreview('file_1', 'blob:local');

    expect(withLocalMediaPreview([{ id: 'file_1', url: 'https://remote' }])[0].url).toBe(
      'blob:local',
    );
  });

  it('returns the same array when no item has a local preview', () => {
    rememberLocalMediaPreview('other', 'blob:other');
    const items = [{ id: 'file_1', url: 'https://remote' }];

    expect(withLocalMediaPreview(items)).toBe(items);
  });

  it('ignores remote URLs so they never replace a local preview', () => {
    rememberLocalMediaPreview('file_1', 'blob:local');
    rememberLocalMediaPreview('file_1', 'https://remote-2');

    expect(withLocalMediaPreview([{ id: 'file_1', url: 'https://remote' }])[0].url).toBe(
      'blob:local',
    );
  });
});
