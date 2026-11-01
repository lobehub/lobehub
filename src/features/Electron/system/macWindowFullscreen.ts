export const MAC_WINDOW_FULLSCREEN_DATASET_KEY = 'windowFullscreen';

export const MAC_WINDOW_FULLSCREEN_SELECTOR = 'html.desktop[data-window-fullscreen]';

export const MAC_PANEL_BG_VAR = '--mac-panel-bg';

export const MAC_VIBRANCY_BACKGROUND = `var(${MAC_PANEL_BG_VAR}, transparent)`;

export const setMacWindowFullscreenAttribute = (isFullScreen: boolean) => {
  const root = document.documentElement;

  if (isFullScreen) root.dataset[MAC_WINDOW_FULLSCREEN_DATASET_KEY] = '';
  else delete root.dataset[MAC_WINDOW_FULLSCREEN_DATASET_KEY];
};
