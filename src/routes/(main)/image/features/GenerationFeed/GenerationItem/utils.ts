import { type Generation, type GenerationBatch } from '@/types/generation';

// Default maximum width for image items
export const DEFAULT_MAX_ITEM_WIDTH = 200;

/**
 * Get image dimensions from various sources
 * Returns width, height and aspect ratio when available
 */
export const getImageDimensions = (
  generation: Generation,
  generationBatch?: GenerationBatch,
): { aspectRatio: string | null; height: number | null; width: number | null } => {
  // 1. Priority: actual dimensions from asset
  if (
    generation.asset?.width &&
    generation.asset?.height &&
    generation.asset.width > 0 &&
    generation.asset.height > 0
  ) {
    const { width, height } = generation.asset;
    return {
      aspectRatio: `${width} / ${height}`,
      height,
      width,
    };
  }

  // 2. Try to get dimensions from generationBatch config
  const config = generationBatch?.config;
  if (config?.width && config?.height && config.width > 0 && config.height > 0) {
    const { width, height } = config;
    return {
      aspectRatio: `${width} / ${height}`,
      height,
      width,
    };
  }

  // 3. Try to get dimensions from generationBatch top-level
  if (
    generationBatch?.width &&
    generationBatch?.height &&
    generationBatch.width > 0 &&
    generationBatch.height > 0
  ) {
    const { width, height } = generationBatch;
    return {
      aspectRatio: `${width} / ${height}`,
      height,
      width,
    };
  }

  // 4. Try to parse from size parameter (format: "1024x768")
  if (config?.size && config.size !== 'auto') {
    const sizeMatch = config.size.match(/^(\d+)x(\d+)$/);
    if (sizeMatch) {
      const [, widthStr, heightStr] = sizeMatch;
      const width = parseInt(widthStr, 10);
      const height = parseInt(heightStr, 10);
      if (width > 0 && height > 0) {
        return {
          aspectRatio: `${width} / ${height}`,
          height,
          width,
        };
      }
    }
  }

  // 5. Try to get aspect ratio only (format: "16:9")
  if (config?.aspectRatio) {
    const ratioMatch = config.aspectRatio.match(/^(\d+):(\d+)$/);
    if (ratioMatch) {
      const [, x, y] = ratioMatch;
      return {
        aspectRatio: `${x} / ${y}`,
        height: null,
        width: null,
      };
    }
  }

  // 6. No dimensions available
  return {
    aspectRatio: null,
    height: null,
    width: null,
  };
};

export const getAspectRatio = (
  generation: Generation,
  generationBatch?: GenerationBatch,
): string => {
  const dimensions = getImageDimensions(generation, generationBatch);
  return dimensions.aspectRatio || '1 / 1';
};

/**
 * Calculate display max width for generation items
 * Ensures height doesn't exceed half screen height based on original aspect ratio
 *
 * @note This function is only used in client-side rendering environments.
 * It directly accesses window.innerHeight and is not designed for SSR compatibility.
 */
export const getThumbnailMaxWidth = (
  generation: Generation,
  generationBatch?: GenerationBatch,
): number => {
  const dimensions = getImageDimensions(generation, generationBatch);

  // Return default width if no dimension information is available
  if (!dimensions.aspectRatio) {
    return DEFAULT_MAX_ITEM_WIDTH;
  }

  // Parse aspect ratio string (format: "16 / 9")
  const [widthStr, heightStr] = dimensions.aspectRatio.split(' / ');
  const aspectRatio = Number(widthStr) / Number(heightStr);

  // Apply screen height constraint (half of screen height)
  // Note: window.innerHeight is safe to use here as this function is client-side only
  const maxScreenHeight = window.innerHeight / 2;
  const maxWidthFromHeight = Math.round(maxScreenHeight * aspectRatio);

  // Use the smaller of: calculated width from height constraint or a reasonable maximum
  const maxReasonableWidth = DEFAULT_MAX_ITEM_WIDTH * 2;
  return Math.min(maxWidthFromHeight, maxReasonableWidth);
};
