// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { selectOptimalWeightDtype } from '@/server/services/comfyui/utils/weightDType';

// Mock the modelRegistry module
vi.mock('@/server/services/comfyui/config/modelRegistry', () => {
  const models = {
    'flux1-dev-fp8-e4m3fn.safetensors': {
      family: 'flux',
      recommendedDtype: 'fp8_e4m3fn',
      variant: 'flux1-dev-fp8-e4m3fn',
    },
    'flux1-dev.safetensors': {
      family: 'flux',
      recommendedDtype: 'default',
      variant: 'flux1-dev',
    },
    'flux1-kontext-dev.safetensors': {
      family: 'flux',
      recommendedDtype: 'default',
      variant: 'flux1-kontext-dev',
    },
    'flux1-schnell-fp8-e4m3fn.safetensors': {
      family: 'flux',
      recommendedDtype: 'fp8_e4m3fn',
      variant: 'flux1-schnell-fp8-e4m3fn',
    },
    'flux1-schnell.safetensors': {
      family: 'flux',
      recommendedDtype: 'default',
      variant: 'flux1-schnell',
    },
    'vision_realistic_flux_dev_fp8_no_clip_v2.safetensors': {
      family: 'flux',
      recommendedDtype: 'fp8_e4m3fn',
      variant: 'vision_realistic_flux_dev_fp8_no_clip_v2',
    },
  };

  return {
    MODEL_ID_VARIANT_MAP: {
      'flux-dev': 'flux1-dev',
      'flux-schnell': 'flux1-schnell',
    },
    MODEL_REGISTRY: models,
  };
});

// Mock the staticModelLookup module
vi.mock('../utils/staticModelLookup', () => {
  const models = {
    'flux1-dev-fp8-e4m3fn.safetensors': {
      family: 'flux',
      recommendedDtype: 'fp8_e4m3fn',
      variant: 'flux1-dev-fp8-e4m3fn',
    },
    'flux1-dev.safetensors': {
      family: 'flux',
      recommendedDtype: 'default',
      variant: 'flux1-dev',
    },
    'flux1-kontext-dev.safetensors': {
      family: 'flux',
      recommendedDtype: 'default',
      variant: 'flux1-kontext-dev',
    },
    'flux1-schnell-fp8-e4m3fn.safetensors': {
      family: 'flux',
      recommendedDtype: 'fp8_e4m3fn',
      variant: 'flux1-schnell-fp8-e4m3fn',
    },
    'flux1-schnell.safetensors': {
      family: 'flux',
      recommendedDtype: 'default',
      variant: 'flux1-schnell',
    },
    'vision_realistic_flux_dev_fp8_no_clip_v2.safetensors': {
      family: 'flux',
      recommendedDtype: 'fp8_e4m3fn',
      variant: 'vision_realistic_flux_dev_fp8_no_clip_v2',
    },
  };

  return {
    resolveModel: vi.fn((modelName: string) => {
      const cleanName = modelName.replace(/^comfyui\//, '');

      // Case-insensitive lookup
      const lowerModelName = cleanName.toLowerCase();
      for (const [key, config] of Object.entries(models)) {
        if (key.toLowerCase() === lowerModelName) {
          return config;
        }
      }
      return null;
    }),
  };
});

describe('selectOptimalWeightDtype', () => {
  it('should return model recommendedDtype for known FLUX models', () => {
    // FLUX Dev models should use default for quality
    expect(selectOptimalWeightDtype('flux1-dev.safetensors')).toBe('default');
    expect(selectOptimalWeightDtype('flux_dev.safetensors')).toBe('default');

    // FLUX Schnell models use default in current registry (fps8 variants have separate entries)
    expect(selectOptimalWeightDtype('flux1-schnell.safetensors')).toBe('default');
    expect(selectOptimalWeightDtype('flux_schnell.safetensors')).toBe('default'); // Not in registry

    // FLUX Kontext models should use default
    expect(selectOptimalWeightDtype('flux1-kontext-dev.safetensors')).toBe('default');
    expect(selectOptimalWeightDtype('flux_kontext.safetensors')).toBe('default');

    // FLUX Krea models should use default
    expect(selectOptimalWeightDtype('flux_krea.safetensors')).toBe('default');
  });

  it('should return default for GGUF models', () => {
    expect(selectOptimalWeightDtype('flux1-dev-Q4_K_S.gguf')).toBe('default');
    expect(selectOptimalWeightDtype('flux1-schnell-Q6_K.gguf')).toBe('default');
  });

  it('should return correct dtype for quantized models that exist in registry', () => {
    // FP8 quantized models that exist in the registry with exact names
    expect(selectOptimalWeightDtype('flux1-dev-fp8-e4m3fn.safetensors')).toBe('fp8_e4m3fn');
    expect(selectOptimalWeightDtype('flux1-schnell-fp8-e4m3fn.safetensors')).toBe('fp8_e4m3fn');

    // Models with approximate names that don't exactly match registry return default
    expect(selectOptimalWeightDtype('flux1-dev-fp8.safetensors')).toBe('default'); // Not exact match
  });

  it('should return default for enterprise lite models', () => {
    expect(selectOptimalWeightDtype('flux.1-lite-8B.safetensors')).toBe('default');
  });

  it('should return default fallback for unknown models', () => {
    expect(selectOptimalWeightDtype('unknown_model.safetensors')).toBe('default');
    expect(selectOptimalWeightDtype('custom_flux.bin')).toBe('default');
    expect(selectOptimalWeightDtype('not_a_flux_model.ckpt')).toBe('default');
    expect(selectOptimalWeightDtype('model.pt')).toBe('default');
    expect(selectOptimalWeightDtype('weird@model&name.safetensors')).toBe('default');

    // Models with precision in filename but not in registry fall back to default
    expect(selectOptimalWeightDtype('flux_model_fp32.safetensors')).toBe('default');
    expect(selectOptimalWeightDtype('flux_model_fp16.safetensors')).toBe('default');
    expect(selectOptimalWeightDtype('flux_model_int8.safetensors')).toBe('default');
    expect(selectOptimalWeightDtype('flux_model_int4.safetensors')).toBe('default');
    expect(selectOptimalWeightDtype('flux_model_nf4.safetensors')).toBe('default');
    expect(selectOptimalWeightDtype('flux_model_bnb.safetensors')).toBe('default');
  });

  it('should be case-insensitive for model detection', () => {
    expect(selectOptimalWeightDtype('FLUX1-DEV.SAFETENSORS')).toBe('default');
    expect(selectOptimalWeightDtype('FLUX1-SCHNELL.SAFETENSORS')).toBe('default');
    expect(selectOptimalWeightDtype('FLUX1-DEV-FP8-E4M3FN.SAFETENSORS')).toBe('fp8_e4m3fn');
  });

  it('should handle community models correctly', () => {
    // Most community models will fall back to default unless specifically in registry
    expect(selectOptimalWeightDtype('Jib_mix_Flux_V11_Krea_b_00001_.safetensors')).toBe('default');
    expect(selectOptimalWeightDtype('RealFlux_1.0b_Dev_Transformer.safetensors')).toBe('default');
    expect(selectOptimalWeightDtype('RealFlux_1.0b_Schnell_Transformer.safetensors')).toBe(
      'default',
    );
    expect(selectOptimalWeightDtype('Jib_Mix_Flux_Krea_b_fp8_00001_.safetensors')).toBe('default');
    expect(selectOptimalWeightDtype('vision_realistic_flux_dev_fp8_no_clip_v2.safetensors')).toBe(
      'fp8_e4m3fn', // This model is actually in the registry
    );
  });

  it('should handle edge cases', () => {
    expect(selectOptimalWeightDtype('flux_model')).toBe('default');
    expect(selectOptimalWeightDtype('flux_model.')).toBe('default');
    expect(selectOptimalWeightDtype('.gguf')).toBe('default');
  });

  describe('simplified logic without user parameters', () => {
    it('should only accept modelName parameter', () => {
      // Function now only takes modelName parameter
      // JavaScript allows extra parameters, so this won't throw, but TypeScript will catch it
      expect(selectOptimalWeightDtype('flux1-dev.safetensors')).toBe('default');
    });

    it('should always use model-based selection', () => {
      // No user choice - always use model configuration or default fallback
      expect(selectOptimalWeightDtype('flux1-dev.safetensors')).toBe('default');
      expect(selectOptimalWeightDtype('flux1-schnell.safetensors')).toBe('default'); // Base model uses default
      expect(selectOptimalWeightDtype('unknown_model.safetensors')).toBe('default');
    });
  });
});
