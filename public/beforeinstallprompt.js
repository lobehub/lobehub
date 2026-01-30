// Capture the beforeinstallprompt event as soon as possible and store it globally
// https://github.com/khmyznikov/pwa-install?tab=readme-ov-file#async-mode
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  window.pwaPromptEvent = e;
});
