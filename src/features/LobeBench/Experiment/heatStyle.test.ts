import { describe, expect, it } from 'vitest';

import { contrastOn, HEAT_MIN_CONTRAST, heatStyle, type HeatTheme } from './heatStyle';

// Token values read from the running app (`getComputedStyle` on `--ant-*`).
const light: HeatTheme = {
  colorBgContainer: '#ffffff',
  colorFillQuaternary: 'rgba(0, 0, 0, 0.015)',
  colorSuccess: '#00a03f',
  colorText: '#1f1f1f',
  colorTextLightSolid: '#fff',
  colorTextSecondary: '#666666',
};
const dark: HeatTheme = {
  colorBgContainer: '#0d0d0d',
  colorFillQuaternary: 'rgba(255, 255, 255, 0.02)',
  colorSuccess: '#80c933',
  colorText: '#e6e6e6',
  colorTextLightSolid: '#fff',
  colorTextSecondary: '#b4b4b4',
};
const rates = Array.from({ length: 21 }, (_, index) => index / 20);

describe('heatStyle', () => {
  it.each([
    ['light', light],
    ['dark', dark],
  ])('keeps AA contrast for every pass rate in the %s theme', (_, theme) => {
    for (const rate of [undefined, ...rates]) {
      const cell = heatStyle(rate, theme);
      expect(
        contrastOn(cell.color, cell.background, theme.colorBgContainer),
      ).toBeGreaterThanOrEqual(HEAT_MIN_CONTRAST);
    }
  });

  it('turns greener as the pass rate rises', () => {
    const green = (rate: number) => heatStyle(rate, light).background;
    expect(green(0)).not.toBe(green(0.5));
    expect(green(0.5)).not.toBe(green(1));
  });

  it('measures text alpha against the cell, not against white', () => {
    // 88% black on white is ~16:1; the same text over solid black is ~1:1.
    expect(contrastOn('rgba(0, 0, 0, 0.88)', '#ffffff', '#ffffff')).toBeGreaterThan(15);
    expect(contrastOn('rgba(0, 0, 0, 0.88)', '#000000', '#ffffff')).toBeLessThan(1.1);
  });
});
