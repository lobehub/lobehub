import { describe, expect, it } from 'vitest';

import { isLocalAvatarPreview } from './pickedAvatar';

describe('isLocalAvatarPreview', () => {
  it('skips the upload preview but keeps stored values', () => {
    expect(isLocalAvatarPreview('data:image/webp;base64,AAAA')).toBe(true);
    expect(isLocalAvatarPreview('https://files.example.com/avatar.webp')).toBe(false);
    expect(isLocalAvatarPreview('🚀')).toBe(false);
  });

  it('treats a deleted avatar as a change, not a preview', () => {
    expect(isLocalAvatarPreview(null)).toBe(false);
  });
});
