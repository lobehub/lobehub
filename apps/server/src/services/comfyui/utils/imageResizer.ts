import debug from 'debug';

const log = debug('lobe-image:comfyui:resizer');

/**
 * Model family size limits based on official documentation
 */
const MODEL_LIMITS = {
  // FLUX family - BFL official limits
  FLUX: {
    max: 1440,
    min: 256,
    ratioMax: 21 / 9, // 2.33
    ratioMin: 9 / 21, // 0.43
    step: 32,
  },
  // SD 1.5 family - Standard Stable Diffusion 1.5
  SD1: {
    max: 768,
    min: 256,
    optimal: 512,
  },
  // SD 3 family - Stable Diffusion 3
  SD3: {
    max: 2048,
    min: 512,
    optimal: 1024,
  },
  // SDXL family - Stable Diffusion XL
  SDXL: {
    max: 2048,
    min: 512,
    optimal: 1024,
  },
} as const;

export type Architecture = keyof typeof MODEL_LIMITS;

/**
 * Image resizer utility for ComfyUI
 * Handles automatic image resizing based on model limitations
 */
export class ImageResizer {
  /**
   * Calculate aspect ratio from string format (e.g., "16:9")
   * Borrowed from BFL implementation
   */
  private calculateRatio(aspectRatio: string): number {
    const [width, height] = aspectRatio.split(':').map(Number);
    return width / height;
  }

  /**
   * Calculate aspect ratio from dimensions
   */
  private calculateRatioFromDimensions(width: number, height: number): number {
    return width / height;
  }

  /**
   * Check if ratio is within allowed range
   */
  private isWithinRatioRange(ratio: number, min: number, max: number): boolean {
    // Use small tolerance for floating point comparison
    const tolerance = 0.001;
    return ratio >= min - tolerance && ratio <= max + tolerance;
  }

  /**
   * Get model limits based on architecture
   */
  private getModelLimits(architecture: string): (typeof MODEL_LIMITS)[keyof typeof MODEL_LIMITS] {
    // Direct mapping from architecture to limits
    // Architecture is guaranteed to exist from WorkflowDetector
    return MODEL_LIMITS[architecture as keyof typeof MODEL_LIMITS];
  }

  /**
   * Calculate target dimensions for resizing
   * Maintains aspect ratio and fits within model limits
   */
  public calculateTargetDimensions(
    width: number,
    height: number,
    architecture: string,
  ): { height: number; needsResize: boolean; width: number } {
    const limits = this.getModelLimits(architecture);
    const ratio = this.calculateRatioFromDimensions(width, height);

    log('Checking dimensions:', {
      architecture,
      limits,
      original: { height, width },
      ratio,
    });

    // Check if resize is needed
    const maxDimension = Math.max(width, height);
    const minDimension = Math.min(width, height);

    // Check ratio limits for FLUX
    if (
      'ratioMin' in limits &&
      'ratioMax' in limits &&
      !this.isWithinRatioRange(ratio, limits.ratioMin, limits.ratioMax)
    ) {
      log('Image ratio out of range:', {
        max: limits.ratioMax,
        min: limits.ratioMin,
        ratio,
      });
      // For ratio issues, we'll still try to resize within dimension limits
      // The model might reject it, but we'll try our best
    }

    // Check if dimensions are within limits
    if (maxDimension <= limits.max && minDimension >= limits.min) {
      return {
        height,
        needsResize: false,
        width,
      };
    }

    // Calculate scale factor to fit within limits
    let scaleFactor = 1;

    // If image is too large, scale down to fit max dimension
    if (maxDimension > limits.max) {
      scaleFactor = limits.max / maxDimension;
    }

    // If image is too small, scale up to fit min dimension
    if (minDimension < limits.min) {
      const minScaleFactor = limits.min / minDimension;
      // Use the larger scale factor to ensure both dimensions are valid
      scaleFactor = Math.max(scaleFactor, minScaleFactor);
    }

    // Calculate new dimensions
    let newWidth = Math.round(width * scaleFactor);
    let newHeight = Math.round(height * scaleFactor);

    // Ensure dimensions are within limits
    newWidth = Math.min(Math.max(newWidth, limits.min), limits.max);
    newHeight = Math.min(Math.max(newHeight, limits.min), limits.max);

    // Round to step size for FLUX models
    if ('step' in limits && limits.step) {
      newWidth = Math.round(newWidth / limits.step) * limits.step;
      newHeight = Math.round(newHeight / limits.step) * limits.step;

      // Ensure still within limits after rounding
      newWidth = Math.min(Math.max(newWidth, limits.min), limits.max);
      newHeight = Math.min(Math.max(newHeight, limits.min), limits.max);
    }

    log('Calculated target dimensions:', {
      new: { height: newHeight, width: newWidth },
      original: { height, width },
      scaleFactor,
    });

    return {
      height: newHeight,
      needsResize: true,
      width: newWidth,
    };
  }
}

// Export singleton instance
export const imageResizer = new ImageResizer();
