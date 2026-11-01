export interface ImageDimensions {
  height: number;
  width: number;
}

type ReferenceImageTokenizer = (image: ImageDimensions) => number;

/**
 * Tokens of an image resized so its short side spans `shortSidePatches` patches: the long side
 * spans the same patch size, rounded to the nearest whole patch, so only the aspect ratio matters.
 */
const aspectRatioPatchGrid =
  (shortSidePatches: number): ReferenceImageTokenizer =>
  ({ height, width }) => {
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    return shortSidePatches * Math.round((shortSidePatches * longSide) / shortSide);
  };

/**
 * How providers meter reference images, keyed by model id.
 *
 * fal H3 Max publishes only sample counts (1:1 → 1,024, 4:3 → 1,376, 16:9 → 1,824, 5:2 → 2,560):
 * https://fal.ai/models/minimax/h3-max/reference-to-video. The 32 × 32 patch grid with round-to-
 * nearest matches those samples and was calibrated against billed units of real requests on
 * 2026-09-30 (3:2, 6:5, 5:6, 360×300, 11:5 and 1.17:1 images). Exact .5 ties were not observed;
 * `Math.round` rounds them up, a difference of at most 32 tokens.
 */
const REFERENCE_IMAGE_TOKENIZERS: Record<string, ReferenceImageTokenizer> = {
  'minimax/h3-max': aspectRatioPatchGrid(32),
};

/**
 * Count the reference-image tokens a model bills for the given images, or `undefined` when the
 * model has no known tokenizer or an image has no usable dimensions.
 */
export const countVideoReferenceImageTokens = (
  model: string,
  images: ImageDimensions[],
): number | undefined => {
  const tokenizer = REFERENCE_IMAGE_TOKENIZERS[model];
  if (!tokenizer) return undefined;

  let total = 0;
  for (const image of images) {
    if (!(image.width > 0 && image.height > 0)) return undefined;
    total += tokenizer(image);
  }
  return total;
};
