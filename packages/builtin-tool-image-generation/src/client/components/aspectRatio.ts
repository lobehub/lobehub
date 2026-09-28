const MIN_RATIO = 9 / 21;
const MAX_RATIO = 21 / 9;

const clampRatio = (ratio: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

const parsePair = (value: unknown, separator: RegExp) => {
  if (typeof value !== 'string') return;
  const [w, h] = value.split(separator).map(Number);
  if (!w || !h || w <= 0 || h <= 0) return;
  return w / h;
};

const positive = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/**
 * Resolve the canvas aspect ratio (width / height) from whatever the call knows
 * so far: the final asset dimensions, or the requested `aspectRatio` / `size` /
 * `width`+`height` parameters. Falls back to a square so the canvas never
 * collapses while the arguments are still streaming in.
 */
export const resolveAspectRatio = (
  parameters?: Record<string, unknown> | null,
  asset?: { height?: number; width?: number } | null,
): number => {
  const assetWidth = positive(asset?.width);
  const assetHeight = positive(asset?.height);
  if (assetWidth && assetHeight) return clampRatio(assetWidth / assetHeight);

  const width = positive(parameters?.width);
  const height = positive(parameters?.height);
  if (width && height) return clampRatio(width / height);

  const ratio = parsePair(parameters?.aspectRatio, /[:/]/) ?? parsePair(parameters?.size, /[x×*]/i);

  return ratio ? clampRatio(ratio) : 1;
};
