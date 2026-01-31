/**
 * Parse ratio string, e.g., "16:9" -> 1.777
 * @param ratio - Ratio string in "width:height" format
 * @returns Ratio value, returns 1:1 ratio on error
 */
export function parseRatio(ratio: string): number {
  if (!ratio || typeof ratio !== 'string') return 1;

  const parts = ratio.split(':');
  if (parts.length !== 2) return 1;

  const [widthStr, heightStr] = parts;
  const width = Number(widthStr);
  const height = Number(heightStr);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }

  return width / height;
}

/**
 * Calculate the most appropriate size based on target ratio and default dimensions
 * @param ratio - Target aspect ratio
 * @param defaultWidth - Default width
 * @param defaultHeight - Default height
 * @returns Calculated size object
 */
export function adaptSizeToRatio(ratio: number, defaultWidth: number, defaultHeight: number) {
  // Validate input parameters
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new Error('Invalid ratio: must be a positive finite number');
  }
  if (!Number.isFinite(defaultWidth) || defaultWidth <= 0) {
    throw new Error('Invalid defaultWidth: must be a positive finite number');
  }
  if (!Number.isFinite(defaultHeight) || defaultHeight <= 0) {
    throw new Error('Invalid defaultHeight: must be a positive finite number');
  }

  const currentRatio = defaultWidth / defaultHeight;

  if (ratio > currentRatio) {
    // Target ratio is wider, keep width and adjust height
    return { width: defaultWidth, height: Math.round(defaultWidth / ratio) };
  } else {
    // Target ratio is taller, keep height and adjust width
    return { width: Math.round(defaultHeight * ratio), height: defaultHeight };
  }
}
