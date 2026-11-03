export const TITLE_BAR_HORIZONTAL_PADDING = 12;
export const WINDOWS_NATIVE_CONTROL_WIDTH = 150;
export const MAC_TRAFFIC_LIGHT_WIDTH = 80;

export const getMacTrafficLightPadding = (isMac: boolean, isFullScreen: boolean): number => {
  if (!isMac || isFullScreen) return 0;

  return MAC_TRAFFIC_LIGHT_WIDTH - TITLE_BAR_HORIZONTAL_PADDING;
};

export interface TitleBarLayoutConfig {
  padding: string;
  reserveNativeControlSpace: boolean;
  showCustomWinControl: boolean;
}

export const getTitleBarLayoutConfig = (platform?: string): TitleBarLayoutConfig => {
  const showCustomWinControl = platform === 'Linux';
  const reserveNativeControlSpace = platform === 'Windows';

  if (showCustomWinControl) {
    return {
      padding: `0 ${TITLE_BAR_HORIZONTAL_PADDING}px 0 0`,
      reserveNativeControlSpace,
      showCustomWinControl,
    };
  }

  if (reserveNativeControlSpace) {
    return {
      padding: `0 ${WINDOWS_NATIVE_CONTROL_WIDTH + TITLE_BAR_HORIZONTAL_PADDING}px 0 ${TITLE_BAR_HORIZONTAL_PADDING}px`,
      reserveNativeControlSpace,
      showCustomWinControl,
    };
  }

  return {
    padding: `0 ${TITLE_BAR_HORIZONTAL_PADDING}px`,
    reserveNativeControlSpace,
    showCustomWinControl,
  };
};
