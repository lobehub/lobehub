import { describe, expect, it } from 'vitest';

import {
  getMacTrafficLightPadding,
  getTitleBarLayoutConfig,
  MAC_TRAFFIC_LIGHT_WIDTH,
  TITLE_BAR_HORIZONTAL_PADDING,
} from './layout';

describe('getTitleBarLayoutConfig', () => {
  it('reserves right-side space for native Windows controls', () => {
    expect(getTitleBarLayoutConfig('Windows')).toEqual({
      padding: `0 162px 0 ${TITLE_BAR_HORIZONTAL_PADDING}px`,
      reserveNativeControlSpace: true,
      showCustomWinControl: false,
    });
  });

  it('keeps Linux custom controls flush right without extra native inset', () => {
    expect(getTitleBarLayoutConfig('Linux')).toEqual({
      padding: `0 ${TITLE_BAR_HORIZONTAL_PADDING}px 0 0`,
      reserveNativeControlSpace: false,
      showCustomWinControl: true,
    });
  });

  it('uses default padding on macOS', () => {
    expect(getTitleBarLayoutConfig('Mac OS')).toEqual({
      padding: `0 ${TITLE_BAR_HORIZONTAL_PADDING}px`,
      reserveNativeControlSpace: false,
      showCustomWinControl: false,
    });
  });
});

describe('getMacTrafficLightPadding', () => {
  it('reserves traffic-light space for regular macOS windows', () => {
    expect(getMacTrafficLightPadding(true, false)).toBe(
      MAC_TRAFFIC_LIGHT_WIDTH - TITLE_BAR_HORIZONTAL_PADDING,
    );
  });

  it('removes traffic-light space for macOS fullscreen windows', () => {
    expect(getMacTrafficLightPadding(true, true)).toBe(0);
  });

  it('does not reserve traffic-light space outside macOS', () => {
    expect(getMacTrafficLightPadding(false, false)).toBe(0);
  });
});
