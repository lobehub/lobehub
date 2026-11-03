import { describe, expect, it } from 'vitest';

import { type MeasureRange, truncateFileNameToWidth } from './TruncatedFileName';

/** Every character is 10px wide. */
const monospace = (name: string): MeasureRange => {
  void name;
  return (start, end) => Math.max(0, end - start) * 10;
};

describe('truncateFileNameToWidth', () => {
  it('keeps a name that fits', () => {
    const name = 'report.pdf';

    expect(truncateFileNameToWidth(name, 100, monospace(name), 30)).toBe(name);
  });

  it('truncates from the middle and keeps the extension', () => {
    const name = 'quarterly-report-final.pdf';

    // 160px: 30px ellipsis + 40px ".pdf" leaves 90px, i.e. 9 base characters
    const result = truncateFileNameToWidth(name, 160, monospace(name), 30);

    expect(result).toBe('quart...inal.pdf');
    expect(result.length * 10).toBeLessThanOrEqual(160);
  });

  it('falls back to the ellipsis and extension when the base cannot fit', () => {
    const name = 'quarterly-report-final.pdf';

    expect(truncateFileNameToWidth(name, 70, monospace(name), 30)).toBe('....pdf');
  });

  it('treats a leading dot as part of the name', () => {
    const name = '.environment-settings';

    expect(truncateFileNameToWidth(name, 100, monospace(name), 30)).toBe('.env...ngs');
  });

  it('measures with the real glyph widths it is given', () => {
    const name = '一个比较长的文件名.md';
    // CJK glyphs are 20px, ASCII 10px
    const widths = [...name].map((char) => (char.charCodeAt(0) > 0xff ? 20 : 10));
    const measure: MeasureRange = (start, end) =>
      widths.slice(start, end).reduce((sum, width) => sum + width, 0);

    const result = truncateFileNameToWidth(name, 150, measure, 30);

    expect(result).toBe('一个...件名.md');
    const resultWidth = [...result].reduce(
      (sum, char) => sum + (char.charCodeAt(0) > 0xff ? 20 : 10),
      0,
    );
    expect(resultWidth).toBeLessThanOrEqual(150);
  });
});
