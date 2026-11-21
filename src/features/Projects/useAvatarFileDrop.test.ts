import { describe, expect, it } from 'vitest';

import { isFileDrag, pickAvatarFile } from './useAvatarFileDrop';

const file = (name: string, type: string) => new File(['x'], name, { type });

describe('useAvatarFileDrop', () => {
  it('takes the first image among the dropped files', () => {
    const png = file('logo.png', 'image/png');

    expect(pickAvatarFile([file('notes.pdf', 'application/pdf'), png])).toBe(png);
  });

  it('rejects files the avatar uploader cannot use', () => {
    expect(pickAvatarFile([file('logo.svg', 'image/svg+xml')])).toBeUndefined();
    expect(pickAvatarFile(null)).toBeUndefined();
  });

  it('only reacts to drags that carry files', () => {
    expect(isFileDrag({ types: ['Files'] } as unknown as DataTransfer)).toBe(true);
    expect(isFileDrag({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
    expect(isFileDrag(null)).toBe(false);
  });
});
