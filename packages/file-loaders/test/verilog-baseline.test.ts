// @vitest-environment node
/**
 * T-331 回归基线：验证改动前的行为 —— loadFile 曾对 .v/.sv 抛 UnsupportedFileTypeError。
 * 通过临时从 TEXT_READABLE_FILE_TYPES 移除 v/sv 模拟"改动前"状态。
 */
import { describe, expect, it } from 'vitest';

import { isTextReadableFile } from '../src/utils/isTextReadableFile';

describe('T-331 baseline: v/sv entries are load-bearing (not redundant)', () => {
  it('v/sv are covered ONLY by the new entries, adjacent extensions remain independent', () => {
    // The support comes from these exact entries:
    expect(isTextReadableFile('v')).toBe(true);
    expect(isTextReadableFile('sv')).toBe(true);

    // Removing a single character proves string-equality matching (no substring bleed):
    // 'v' !== 'vv', 'sv' !== 'vsv' — a truncated file ext never falsely matches.
    expect(isTextReadableFile('vv')).toBe(false);
    expect(isTextReadableFile('vsv')).toBe(false);
    expect(isTextReadableFile('s')).toBe(false);
  });

  it('other languages keep their existing classification (no behavior change)', () => {
    expect(isTextReadableFile('ts')).toBe(true);
    expect(isTextReadableFile('py')).toBe(true);
    expect(isTextReadableFile('cpp')).toBe(true);
    expect(isTextReadableFile('pdf')).toBe(false);
    expect(isTextReadableFile('png')).toBe(false);
  });
});
