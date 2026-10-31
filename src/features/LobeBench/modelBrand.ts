/**
 * Brand colors for the leaderboard's bars, the way LobeBench posters color
 * them: each model's brand from `@lobehub/icons`, matched the way `ModelIcon`
 * matches an icon (the first mapping with a keyword pattern in the model id).
 */
export interface BrandMapping {
  Icon: unknown;
  keywords: string[];
}

export const findBrandColor = (
  mappings: readonly BrandMapping[] | undefined,
  model: string | undefined,
): string | undefined => {
  if (!mappings || !model) return undefined;
  const id = model.toLowerCase();
  const hit = mappings.find((item) =>
    item.keywords.some((keyword) => new RegExp(keyword, 'i').test(id)),
  );
  return (hit?.Icon as { colorPrimary?: string } | undefined)?.colorPrimary || undefined;
};

// lobe-design-ignore LOBE-RAW-COLOR: Parse provider brand-color data; these values are not interface theme tokens.
const BLACKS = new Set(['#000', '#000000', 'black', 'rgb(0,0,0)', 'rgb(0, 0, 0)']);
// lobe-design-ignore LOBE-RAW-COLOR: Parse provider brand-color data; these values are not interface theme tokens.
const WHITES = new Set(['#fff', '#ffffff', 'white', 'rgb(255,255,255)', 'rgb(255, 255, 255)']);

/** Flip near-black / near-white brands (OpenAI, xAI) so the bar shows on either theme. */
export const adaptBrandColor = (color: string, isDarkMode: boolean) => {
  const normalized = color.trim().toLowerCase();
  // lobe-design-ignore LOBE-RAW-COLOR: Preserve the monochrome provider brand while adapting it to the current theme.
  if (BLACKS.has(normalized) || WHITES.has(normalized)) return isDarkMode ? '#ffffff' : '#000000';
  return color;
};
