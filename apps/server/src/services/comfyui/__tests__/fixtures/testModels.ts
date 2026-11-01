/**
 * Real model names from registry for testing
 * Using actual registered models instead of fake names
 */

// Real FLUX models from registry
export const TEST_FLUX_MODELS = {
  DEV: 'flux1-dev.safetensors',
  KONTEXT: 'flux1-kontext-dev.safetensors',
  KREA: 'flux1-krea-dev.safetensors',
  SCHNELL: 'flux1-schnell.safetensors',
} as const;

// Real SD3.5 models from registry
export const TEST_SD35_MODELS = {
  LARGE: 'sd3.5_large.safetensors',
  LARGE_FP8: 'sd3.5_large_fp8_scaled.safetensors',
  LARGE_TURBO: 'sd3.5_large_turbo.safetensors',
  MEDIUM: 'sd3.5_medium.safetensors',
} as const;

// Real SDXL models from registry
export const TEST_SDXL_MODELS = {
  BASE: 'sd_xl_base_1.0.safetensors',
  TURBO: 'sd_xl_turbo_1.0_fp16.safetensors',
} as const;

// Custom SD model
export const TEST_CUSTOM_SD = 'custom_sd_lobe.safetensors';

// Real component names from system components
export const TEST_COMPONENTS = {
  FLUX: {
    CLIP_L: 'clip_l.safetensors',
    T5: 't5xxl_fp16.safetensors',
    VAE: 'ae.safetensors',
  },
  SD: {
    CLIP_G: 'clip_g.safetensors',
    CLIP_L: 'clip_l.safetensors',
    VAE: 'sdxl_vae_fp16fix.safetensors',
  },
} as const;

// Common test model sets for different scenarios
export const TEST_MODEL_SETS = {
  // Models that don't exist (for error testing)
  NON_EXISTENT: [
    'nonexistent-model.safetensors',
    'unknown-model.safetensors',
    'fake-model.safetensors',
  ],

  // Models that should exist in registry
  REGISTERED: [
    TEST_FLUX_MODELS.DEV,
    TEST_FLUX_MODELS.SCHNELL,
    TEST_SD35_MODELS.LARGE,
    TEST_SDXL_MODELS.BASE,
  ],
} as const;

// Default test model for general use
export const DEFAULT_TEST_MODEL = TEST_FLUX_MODELS.DEV;
