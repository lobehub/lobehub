import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDarwinMajorVersion, isMacOSWithLargeWindowBorders } from '@/utils/platform';

import { getInnerCssVariables, getOuterCssVariables } from './cssVariables';

vi.mock('@/utils/platform', () => ({
  getDarwinMajorVersion: vi.fn(() => 0),
  isMacOSWithLargeWindowBorders: vi.fn(() => false),
}));

const mockDarwin = vi.mocked(getDarwinMajorVersion);
const mockLargeBorders = vi.mocked(isMacOSWithLargeWindowBorders);

beforeEach(() => {
  mockDarwin.mockReturnValue(0);
  mockLargeBorders.mockReturnValue(false);
});

describe('getOuterCssVariables', () => {
  it('drops the left padding while the nav panel is expanded', () => {
    expect(getOuterCssVariables({ expand: true })['--container-padding-left']).toBe('0px');
    expect(getOuterCssVariables({ expand: false })['--container-padding-left']).toBe('8px');
  });
});

describe('getInnerCssVariables', () => {
  it('uses the token radius below darwin 25', () => {
    mockDarwin.mockReturnValue(24);
    const vars = getInnerCssVariables({ isDark: false });

    expect(vars['--container-border-radius']).toBe('var(--ant-border-radius)');
    expect(vars['--container-border-bottom-right-radius']).toBe('var(--ant-border-radius)');
  });

  it('switches to 12px from darwin 25, and rounds the bottom-right too from darwin 26', () => {
    mockDarwin.mockReturnValue(25);
    const darwin25 = getInnerCssVariables({ isDark: false });
    expect(darwin25['--container-border-radius']).toBe('12px');
    expect(darwin25['--container-border-bottom-right-radius']).toBe('12px');

    mockDarwin.mockReturnValue(26);
    expect(getInnerCssVariables({ isDark: false })['--container-border-bottom-right-radius']).toBe(
      '12px',
    );
  });

  it('rounds the bottom-right on macOS builds with large window borders', () => {
    mockDarwin.mockReturnValue(24);
    mockLargeBorders.mockReturnValue(true);

    expect(getInnerCssVariables({ isDark: false })['--container-border-bottom-right-radius']).toBe(
      '12px',
    );
  });

  it('softens the border color in dark mode', () => {
    expect(getInnerCssVariables({ isDark: true })['--container-border-color']).toBe(
      'var(--ant-color-border-secondary)',
    );
    expect(getInnerCssVariables({ isDark: false })['--container-border-color']).toBe(
      'var(--ant-color-border)',
    );
  });
});
