import { describe, expect, it } from 'vitest';

import { formatPageEditorInfoTime } from './formatPageEditorInfoTime';

describe('formatPageEditorInfoTime', () => {
  it('formats page info time with the active locale', () => {
    const date = new Date(2026, 6, 1, 12, 16);

    expect(formatPageEditorInfoTime(date, 'zh-CN')).toBe('2026年7月1日 12:16');
    expect(formatPageEditorInfoTime(date, 'en-US')).toBe('Jul 1, 2026, 12:16 PM');
  });

  it('returns empty text for missing or invalid values', () => {
    expect(formatPageEditorInfoTime(undefined, 'zh-CN')).toBe('');
    expect(formatPageEditorInfoTime('invalid', 'zh-CN')).toBe('');
  });
});
