export const LOADING_SCREEN_ID = 'loading-screen';

export const removeStaticLoadingScreen = (): void => {
  document.getElementById(LOADING_SCREEN_ID)?.remove();
};
