import { DEFAULT_DIMENSION_CONSTRAINTS } from 'model-bank';

import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';

import { constrainDimensions } from '../utils/dimensionConstraints';

/**
 * Extract URL and dimensions from callback data (supports both old and new API)
 */
const extractUrlAndDimensions = (
  data?: string | { dimensions?: { height: number; width: number }; url: string },
) => {
  const url = typeof data === 'string' ? data : data?.url;
  const dimensions = typeof data === 'object' ? data?.dimensions : undefined;
  return { dimensions, url };
};

/**
 * Custom hook for automatically setting image dimensions with model constraints
 * @returns Function to auto-set dimensions and type processing utilities
 */
export const useAutoDimensions = () => {
  const paramsSchema = useImageStore(imageGenerationConfigSelectors.parametersSchema);
  const isSupportWidth = useImageStore(imageGenerationConfigSelectors.isSupportedParam('width'));
  const isSupportHeight = useImageStore(imageGenerationConfigSelectors.isSupportedParam('height'));
  const setWidth = useImageStore((s) => s.setWidth);
  const setHeight = useImageStore((s) => s.setHeight);

  /**
   * Auto-set dimensions with model constraints if parameters are supported
   */
  const autoSetDimensions = (dimensions: { height: number; width: number }) => {
    if (!isSupportWidth || !isSupportHeight) return;

    const constraints = {
      height: {
        max: paramsSchema.height?.max || DEFAULT_DIMENSION_CONSTRAINTS.MAX_SIZE,
        min: paramsSchema.height?.min || DEFAULT_DIMENSION_CONSTRAINTS.MIN_SIZE,
      },
      width: {
        max: paramsSchema.width?.max || DEFAULT_DIMENSION_CONSTRAINTS.MAX_SIZE,
        min: paramsSchema.width?.min || DEFAULT_DIMENSION_CONSTRAINTS.MIN_SIZE,
      },
    };

    const adjusted = constrainDimensions(dimensions.width, dimensions.height, constraints);
    setWidth(adjusted.width);
    setHeight(adjusted.height);
  };

  return {
    autoSetDimensions,
    canAutoSet: isSupportWidth && isSupportHeight,
    extractUrlAndDimensions,
  };
};
