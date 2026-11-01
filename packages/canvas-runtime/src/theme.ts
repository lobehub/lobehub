import { type LobeThemeState, setLobeTheme } from '@lobehub/ui';

declare global {
  interface Window {
    __LOBE_CANVAS_THEME__?: Partial<LobeThemeState>;
  }
}

const systemAppearance = () =>
  matchMedia('(prefers-color-scheme: dark)').matches ? ('dark' as const) : ('light' as const);

export const startThemeSync = () => {
  let hostTheme = window.__LOBE_CANVAS_THEME__;

  const apply = () => {
    const appearance = hostTheme?.appearance ?? systemAppearance();
    setLobeTheme({ ...hostTheme, appearance });
    document.documentElement.style.colorScheme = appearance;
  };

  const onTheme = (event: Event) => {
    hostTheme = (event as CustomEvent<Partial<LobeThemeState>>).detail;
    apply();
  };
  const onSystemTheme = () => {
    if (!hostTheme?.appearance) apply();
  };
  const media = matchMedia('(prefers-color-scheme: dark)');
  window.addEventListener('lobe-canvas-theme', onTheme);
  media.addEventListener('change', onSystemTheme);

  apply();
  return () => {
    window.removeEventListener('lobe-canvas-theme', onTheme);
    media.removeEventListener('change', onSystemTheme);
  };
};
