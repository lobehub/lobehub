/**
 * Simple Workflow Detector
 */
import { resolveModel } from './staticModelLookup';

export interface WorkflowDetectionResult {
  architecture: 'FLUX' | 'SD3' | 'SD1' | 'SDXL' | 'unknown';
  isSupported: boolean;
  variant?: string;
}

export type FluxVariant = 'dev' | 'schnell' | 'kontext';
export type SD3Variant = 'sd35' | 'sd-t2i';
export type SDVariant = 'sd-t2i' | 'sd-i2i' | 'custom-sd';

/**
 * Simple workflow type detector using model registry
 */
export const WorkflowDetector = {
  /**
   * Detect model type using model registry - O(1) lookup
   */
  detectModelType(modelId: string): WorkflowDetectionResult {
    const cleanId = modelId.replace(/^comfyui\//, '');

    // Special handling for custom SD models - hardcoded, not in registry
    if (cleanId === 'stable-diffusion-custom' || cleanId === 'stable-diffusion-custom-refiner') {
      return {
        architecture: 'SDXL', // Custom SD uses SDXL architecture (supports img2img)
        isSupported: true,
        variant: 'custom-sd',
      };
    }

    // Check if model exists in registry
    const config = resolveModel(cleanId);

    if (config) {
      return {
        architecture:
          config.modelFamily === 'FLUX'
            ? 'FLUX'
            : config.modelFamily === 'SD3'
              ? 'SD3'
              : config.modelFamily === 'SD1'
                ? 'SD1'
                : config.modelFamily === 'SDXL'
                  ? 'SDXL'
                  : 'unknown',
        isSupported: true,
        variant: config.variant,
      };
    }

    return {
      architecture: 'unknown',
      isSupported: false,
    };
  },
};
