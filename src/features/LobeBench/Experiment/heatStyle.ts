import chroma from 'chroma-js';

/** WCAG AA for the 12px rate text in a cell. */
export const HEAT_MIN_CONTRAST = 4.5;

/** The theme colours a heat cell is computed from (`useTheme()` values). */
export interface HeatTheme {
  colorBgContainer: string;
  colorFillQuaternary: string;
  colorSuccess: string;
  colorText: string;
  colorTextLightSolid: string;
  colorTextSecondary: string;
}

/** A colour drawn over `background`, as the eye sees it (alpha composited). */
const over = (color: string, background: string) => {
  const top = chroma(color);
  return chroma.mix(background, top.alpha(1), top.alpha(), 'rgb').alpha(1);
};

/** WCAG contrast of `text` read on `background`; both may carry alpha. */
export const contrastOn = (text: string, background: string, page: string) => {
  const surface = over(background, page);
  return chroma.contrast(over(text, surface.hex()), surface);
};

/**
 * A category cell's colours: greener the higher its pass rate, muted with none.
 * The background is a solid mix of the theme's success colour into the page, and
 * the text takes whichever of the theme's dark or light text reads better on it,
 * so every cell keeps WCAG AA contrast in light and dark themes alike.
 */
export const heatStyle = (rate: number | undefined, theme: HeatTheme) => {
  const page = over(theme.colorBgContainer, '#fff').hex();
  if (rate === undefined)
    return {
      background: over(theme.colorFillQuaternary, page).hex(),
      color: theme.colorTextSecondary,
    };
  const pick = (weight: number) => {
    const background = chroma.mix(page, theme.colorSuccess, weight, 'rgb').hex();
    const [color] = [theme.colorText, theme.colorTextLightSolid]
      .map((text) => ({ contrast: contrastOn(text, background, page), text }))
      .sort((a, b) => b.contrast - a.contrast);
    return { background, color: color.text, contrast: color.contrast };
  };
  // Where neither text colour reaches AA (a mid green under light text), the
  // cell gives up some green rather than legibility.
  let weight = 0.12 + Math.min(Math.max(rate, 0), 1) * 0.5;
  let cell = pick(weight);
  while (cell.contrast < HEAT_MIN_CONTRAST && weight > 0.12) {
    weight = Math.max(0.12, weight - 0.02);
    cell = pick(weight);
  }
  return { background: cell.background, color: cell.color };
};
