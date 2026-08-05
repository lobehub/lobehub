import { IMAGE_GENERATION_CONFIG, MAX_SEED } from 'model-bank/standardParameters';
import prand from 'pure-rand';

export function generateUniqueSeeds(seedCount: number): number[] {
  // Use current timestamp as the initial seed
  const initialSeed = Date.now();

  // Create an instance of Xoroshiro128+ random number generator
  let rng = prand.xoroshiro128plus(initialSeed);

  const seeds = new Set<number>();

  while (seeds.size < seedCount) {
    // Generate a 31-bit random integer (PostgreSQL INTEGER compatible)
    const [randomInt, nextRng] = prand.uniformIntDistribution(0, MAX_SEED, rng);

    // Update RNG state
    rng = nextRng;

    // Add to the set, ensuring uniqueness
    seeds.add(randomInt);
  }

  return Array.from(seeds);
}

/**
 * Calculate thumbnail dimensions
 * Generate thumbnail with configurable max edge size
 */
export function calculateThumbnailDimensions(
  originalWidth: number,
  originalHeight: number,
  maxSize: number = IMAGE_GENERATION_CONFIG.THUMBNAIL_MAX_SIZE,
): {
  shouldResize: boolean;
  thumbnailHeight: number;
  thumbnailWidth: number;
} {
  const shouldResize = originalWidth > maxSize || originalHeight > maxSize;

  if (!shouldResize) {
    return {
      shouldResize: false,
      thumbnailHeight: originalHeight,
      thumbnailWidth: originalWidth,
    };
  }

  const thumbnailWidth =
    originalWidth > originalHeight
      ? maxSize
      : Math.round((originalWidth * maxSize) / originalHeight);

  const thumbnailHeight =
    originalHeight > originalWidth
      ? maxSize
      : Math.round((originalHeight * maxSize) / originalWidth);

  return {
    shouldResize: true,
    thumbnailHeight,
    thumbnailWidth,
  };
}
