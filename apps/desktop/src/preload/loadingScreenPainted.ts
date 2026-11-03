import { ipcRenderer } from 'electron';

import { LOADING_SCREEN_PAINTED_CHANNEL } from '~common/loadingScreen';

export const reportLoadingScreenPainted = () => {
  const observer = new MutationObserver(() => {
    if (!document.getElementById('loading-screen')) return;
    observer.disconnect();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => ipcRenderer.send(LOADING_SCREEN_PAINTED_CHANNEL)),
    );
  });
  observer.observe(document, { childList: true, subtree: true });
};
