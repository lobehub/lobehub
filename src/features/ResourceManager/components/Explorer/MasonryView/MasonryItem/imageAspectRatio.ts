/**
 * Box reserved for a thumbnail whose dimensions we don't know yet. Any value
 * shifts once when the real bitmap lands, but a reserved box keeps the masonry
 * columns from collapsing and re-flowing while the images stream in.
 */
export const FALLBACK_ASPECT_RATIO = 4 / 3;

/**
 * Aspect ratio recorded at upload time (`FileMetadataSchema`: width / height /
 * ratio), which keeps an image card at its final size from the first paint.
 * Uploads that never measured the bitmap — CLI, desktop, public API, anything
 * older than the metadata rollout — return `undefined` and fall back to
 * {@link FALLBACK_ASPECT_RATIO}.
 */
export const readAspectRatio = (metadata?: Record<string, any> | null): number | undefined => {
  const ratio = Number(metadata?.ratio);
  if (Number.isFinite(ratio) && ratio > 0) return ratio;

  const width = Number(metadata?.width);
  const height = Number(metadata?.height);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return undefined;

  return width / height;
};
