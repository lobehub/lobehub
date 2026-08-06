import { describe, expect, it } from 'vitest';

import { getTextDirectionFromFirstStrong } from './getTextDirectionFromFirstStrong';

describe('getTextDirectionFromFirstStrong', () => {
  it('returns rtl when the first strong character is Persian/Arabic', () => {
    expect(getTextDirectionFromFirstStrong('سلام world')).toBe('rtl');
    expect(getTextDirectionFromFirstStrong('  سلام')).toBe('rtl');
  });

  it('returns ltr when the first strong character is Latin', () => {
    expect(getTextDirectionFromFirstStrong('hello سلام')).toBe('ltr');
    expect(getTextDirectionFromFirstStrong('  hello')).toBe('ltr');
  });

  it('keeps rtl when English appears mid Persian sentence', () => {
    expect(getTextDirectionFromFirstStrong('من از GPT استفاده می‌کنم')).toBe('rtl');
  });

  it('ignores leading digits and punctuation', () => {
    expect(getTextDirectionFromFirstStrong('123 سلام')).toBe('rtl');
    expect(getTextDirectionFromFirstStrong('...hello')).toBe('ltr');
  });

  it('returns null for empty or neutral-only text', () => {
    expect(getTextDirectionFromFirstStrong('')).toBeNull();
    expect(getTextDirectionFromFirstStrong('   ')).toBeNull();
    expect(getTextDirectionFromFirstStrong('123')).toBeNull();
  });
});
