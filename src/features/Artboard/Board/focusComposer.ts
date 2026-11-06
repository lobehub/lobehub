export const COMPOSER_INPUT_ID = 'artboard-composer-input';

export const focusComposer = () => {
  // The composer mounts with the selection, one render after the click that made it.
  setTimeout(() => document.getElementById(COMPOSER_INPUT_ID)?.focus(), 80);
};
