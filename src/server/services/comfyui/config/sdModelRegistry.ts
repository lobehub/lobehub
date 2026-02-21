/**
 * Stable Diffusion Model Registry - Separated for maintainability
 * Contains all SD1.5, SDXL, and SD3.5 model family registrations
 */
import { type ModelConfig } from './modelRegistry';

/* eslint-disable sort-keys-fix/sort-keys-fix */
export const SD_MODEL_REGISTRY: Record<string, ModelConfig> = {
  // ===================================================================
  // SD3.5 Model Family Registry
  // ===================================================================

  // SD3.5 Models (requires clip_g.safetensors)
  'sd3.5_large.safetensors': {
    priority: 1,
    variant: 'sd35',
    modelFamily: 'SD3',
  },
  'sd3.5_large_turbo.safetensors': {
    priority: 2,
    variant: 'sd35',
    modelFamily: 'SD3',
  },
  'sd3.5_medium.safetensors': {
    priority: 3,
    variant: 'sd35',
    modelFamily: 'SD3',
  },
  'sd3.5_large_fp8_scaled.safetensors': {
    priority: 1,
    variant: 'sd35',
    modelFamily: 'SD3',
  },

  // SD3.5 Models (With CLIP - includes CLIP/T5 internally)
  'sd3.5_medium_incl_clips_t5xxlfp8scaled.safetensors': {
    priority: 1,
    variant: 'sd35-inclclip',
    modelFamily: 'SD3',
  },

  // === Custom SD Models (for user-uploaded models) ===
  // These entries serve as examples for custom model support
  'custom-sd-model.safetensors': {
    priority: 3,
    variant: 'custom-sd',
    modelFamily: 'SD1',
  },
  'custom-sd-refiner.safetensors': {
    priority: 3,
    variant: 'custom-sd',
    modelFamily: 'SD1',
  },

  // ===================================================================
  // SD1.5 Model Family Registry (Built-in CLIP/VAE)
  // ===================================================================

  // === SD1.5 Official Models (Priority 1) ===
  'v1-5-pruned-emaonly.safetensors': {
    priority: 1,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned-emaonly-fp16.safetensors': {
    priority: 1,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned.safetensors': {
    priority: 1,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned-emaonly.ckpt': {
    priority: 2,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },

  // === SD1.5 Quantized Models (Priority 2) ===
  'v1-5-pruned-emaonly-F16.gguf': {
    priority: 2,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned-emaonly-Q8_0.gguf': {
    priority: 2,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned-emaonly-Q6_K.gguf': {
    priority: 2,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned-emaonly-Q5_K_M.gguf': {
    priority: 2,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned-emaonly-Q5_K_S.gguf': {
    priority: 2,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned-emaonly-Q4_K_M.gguf': {
    priority: 2,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned-emaonly-Q4_K_S.gguf': {
    priority: 2,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned-emaonly-Q4_0.gguf': {
    priority: 2,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned-emaonly-Q3_K_M.gguf': {
    priority: 2,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned-emaonly-Q3_K_S.gguf': {
    priority: 2,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'v1-5-pruned-emaonly-Q2_K.gguf': {
    priority: 2,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },

  // === SD1.5 Community Models (Priority 3) ===
  'dreamshaper_8.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'DreamShaper_8_pruned.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'Deliberate_v2.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'Deliberate_v6.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'Realistic_Vision_V5.1.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'Realistic_Vision_V5.1_fp16-no-ema.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'realisticVisionV60B1_v60B1VAE.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'Chilloutmix.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'chilloutmix-Ni.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'chilloutmix_NiPrunedFp16Fix.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'chilloutmix_NiPrunedFp32Fix.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'braV7.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'guofeng3_v34.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'koreanDollLikeness_v20.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'AnythingV5Ink_ink.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'neverendingDream_v122.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'majestixMix_v70.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'kissMix2_v20.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'xxmix9realistic_v40.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'tangYuan_v50.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'flat2DAnimerge_v45Sharp.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'cyberrealistic_v33.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },
  'analog-diffusion-1.0.safetensors': {
    priority: 3,
    variant: 'sd15-t2i',
    modelFamily: 'SD1',
  },

  // ===================================================================
  // SDXL Model Family Registry (Built-in CLIP/VAE)
  // ===================================================================

  // === SDXL Text-to-Image Models (Priority 1) ===
  'sd_xl_base_1.0.safetensors': {
    priority: 1,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_turbo_1.0_fp16.safetensors': {
    priority: 1,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_base_1.0_0.9vae.safetensors': {
    priority: 1,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },

  // === SDXL Image-to-Image Models (Refiner) ===
  'sd_xl_refiner_1.0.safetensors': {
    priority: 1,
    variant: 'sdxl-i2i',
    modelFamily: 'SDXL',
  },

  // === SDXL Quantized Models (Priority 2) ===
  'sd_xl_base_1.0-F16.gguf': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_base_1.0-Q8_0.gguf': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_base_1.0-Q6_K.gguf': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_base_1.0-Q5_K_M.gguf': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_base_1.0-Q5_K_S.gguf': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_base_1.0-Q4_K_M.gguf': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_base_1.0-Q4_K_S.gguf': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_base_1.0-Q4_0.gguf': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_base_1.0-Q3_K_M.gguf': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_base_1.0-Q3_K_S.gguf': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_base_1.0-Q2_K.gguf': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },

  // === SDXL Refiner Quantized Models ===
  'sd_xl_refiner_1.0-F16.gguf': {
    priority: 2,
    variant: 'sdxl-i2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_refiner_1.0-Q8_0.gguf': {
    priority: 2,
    variant: 'sdxl-i2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_refiner_1.0-Q6_K.gguf': {
    priority: 2,
    variant: 'sdxl-i2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_refiner_1.0-Q5_K_M.gguf': {
    priority: 2,
    variant: 'sdxl-i2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_refiner_1.0-Q5_K_S.gguf': {
    priority: 2,
    variant: 'sdxl-i2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_refiner_1.0-Q4_K_M.gguf': {
    priority: 2,
    variant: 'sdxl-i2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_refiner_1.0-Q4_K_S.gguf': {
    priority: 2,
    variant: 'sdxl-i2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_refiner_1.0-Q4_0.gguf': {
    priority: 2,
    variant: 'sdxl-i2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_refiner_1.0-Q3_K_M.gguf': {
    priority: 2,
    variant: 'sdxl-i2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_refiner_1.0-Q3_K_S.gguf': {
    priority: 2,
    variant: 'sdxl-i2i',
    modelFamily: 'SDXL',
  },
  'sd_xl_refiner_1.0-Q2_K.gguf': {
    priority: 2,
    variant: 'sdxl-i2i',
    modelFamily: 'SDXL',
  },

  // === SDXL Enterprise Models (Priority 2) ===
  'SSD-1B.safetensors': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'SSD-1B-modelspec.safetensors': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sdxl_lightning_1step.safetensors': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sdxl_lightning_4step.safetensors': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sdxl_lightning_8step.safetensors': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'diffusion_pytorch_model.fp16.safetensors': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'lcm_lora_sdxl.safetensors': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },

  // === SDXL Community Models (Priority 3) ===
  'juggernautXL_v9Rdphoto2Lightning.safetensors': {
    priority: 3,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'realvisxlV50_v50Bakedvae.safetensors': {
    priority: 3,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'dreamshaperXL_v21TurboDPMSDE.safetensors': {
    priority: 3,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'ponyDiffusionV6XL_v6StartWithThisOne.safetensors': {
    priority: 3,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'novaAnimeXL_il.safetensors': {
    priority: 3,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'nebulaeAnimeStyleSDXL_v20.safetensors': {
    priority: 3,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'counterfeitxl_v25.safetensors': {
    priority: 3,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'animagineXLV31_v31.safetensors': {
    priority: 3,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'bluepencilXL_v100.safetensors': {
    priority: 3,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'sudachi_v10.safetensors': {
    priority: 3,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },

  // === Playground Models (Based on SDXL Architecture) ===
  'playground-v2.5-1024px-aesthetic.fp16.safetensors': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'playground-v2.5-1024px-aesthetic.safetensors': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'playground-v2-1024px-aesthetic.fp16.safetensors': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
  'playground-v2-1024px-aesthetic.safetensors': {
    priority: 2,
    variant: 'sdxl-t2i',
    modelFamily: 'SDXL',
  },
};
/* eslint-enable sort-keys-fix/sort-keys-fix */
