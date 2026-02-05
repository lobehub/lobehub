/**
 * System Components Registry Configuration
 */
import { ConfigError } from '@/server/services/comfyui/errors';

export interface ComponentConfig {
  /** Compatible model variants (for LoRA and ControlNet) */
  compatibleVariants?: string[];
  /** ControlNet type (for ControlNet components only) */
  controlnetType?: string;
  /** Model family this component is designed for */
  modelFamily: string;
  /** Priority level: 1=Essential/Official, 2=Standard/Professional, 3=Optional/Community */
  priority: number;
  /** Component type */
  type: string;
}

// Model family constants (for business logic reference)
export const MODEL_FAMILIES = {
  FLUX: 'FLUX',
  SD1: 'SD1',
  SD3: 'SD3',
  SDXL: 'SDXL',
} as const;

// Component type constants (for business logic reference)
export const COMPONENT_TYPES = {
  CLIP: 'clip',
  CONTROLNET: 'controlnet',
  LORA: 'lora',
  T5: 't5',
  VAE: 'vae',
} as const;

// ControlNet type constants
export const CONTROLNET_TYPES = {
  CANNY: 'canny',
  DEPTH: 'depth',
  HED: 'hed',
  NORMAL: 'normal',
  POSE: 'pose',
  SCRIBBLE: 'scribble',
  SEMANTIC: 'semantic',
} as const;

/* eslint-disable sort-keys-fix/sort-keys-fix */
export const SYSTEM_COMPONENTS: Record<string, ComponentConfig> = {
  // ===================================================================
  // === ESSENTIAL COMPONENTS (Priority 1) ===
  // ===================================================================

  'ae.safetensors': {
    modelFamily: 'FLUX',
    priority: 1,
    type: 'vae',
  },

  'clip_l.safetensors': {
    modelFamily: 'FLUX',
    priority: 1,
    type: 'clip',
  },

  'clip_g.safetensors': {
    modelFamily: 'SD3',
    priority: 1,
    type: 'clip',
  },

  't5xxl_fp16.safetensors': {
    modelFamily: 'FLUX',
    priority: 1,
    type: 't5',
  },

  // ===================================================================
  // === OPTIONAL COMPONENTS (Priority 2-3) ===
  // ===================================================================
  't5xxl_fp8_e4m3fn.safetensors': {
    modelFamily: 'FLUX',
    priority: 2,
    type: 't5',
  },

  't5xxl_fp8_e4m3fn_scaled.safetensors': {
    modelFamily: 'FLUX',
    priority: 2,
    type: 't5',
  },

  't5xxl_fp8_e5m2.safetensors': {
    modelFamily: 'FLUX',
    priority: 2,
    type: 't5',
  },

  'google_t5-v1_1-xxl_encoderonly-fp16.safetensors': {
    modelFamily: 'FLUX',
    priority: 3,
    type: 't5',
  },

  // ===================================================================
  // === VAE MODELS ===
  // ===================================================================

  // SD1 VAE Models
  'vae-ft-mse-840000-ema-pruned.safetensors': {
    modelFamily: 'SD1',
    priority: 1,
    type: 'vae',
  },

  'sd-vae-ft-ema.safetensors': {
    modelFamily: 'SD1',
    priority: 1,
    type: 'vae',
  },

  // SDXL VAE Models
  'sdxl_vae.safetensors': {
    modelFamily: 'SDXL',
    priority: 1,
    type: 'vae',
  },

  'sdxl.vae.safetensors': {
    modelFamily: 'SDXL',
    priority: 1,
    type: 'vae',
  },

  'sd_xl_base_1.0_0.9vae.safetensors': {
    modelFamily: 'SDXL',
    priority: 2,
    type: 'vae',
  },

  // ===================================================================
  // === LORA ADAPTERS ===
  // ===================================================================

  // XLabs-AI Official FLUX LoRA Adapters (Priority 1 - Official)
  'realism_lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 1,
    type: 'lora',
  },

  'anime_lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 1,
    type: 'lora',
  },

  'disney_lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 1,
    type: 'lora',
  },

  'scenery_lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 1,
    type: 'lora',
  },

  'art_lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 1,
    type: 'lora',
  },

  'mjv6_lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 1,
    type: 'lora',
  },

  'flux-realism-lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 1,
    type: 'lora',
  },

  'flux-lora-collection-8-styles.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 1,
    type: 'lora',
  },

  'disney-anime-art-lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 1,
    type: 'lora',
  },

  // LiblibAI Professional LoRA (Priority 2 - Professional)
  'flux-kodak-grain-lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 2,
    type: 'lora',
  },

  'flux-first-person-selfie-lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 2,
    type: 'lora',
  },

  'flux-anime-rainbow-light-lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 2,
    type: 'lora',
  },

  'flux-detailer-enhancement-lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 2,
    type: 'lora',
  },

  // CivitAI Special Effects LoRA (Priority 2 - Professional)
  'Envy_Flux_Reanimated_lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 2,
    type: 'lora',
  },

  'Photon_Construct_Flux_V1_0_lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 2,
    type: 'lora',
  },

  // ModelScope LoRA Collection (Priority 2 - Professional)
  'flux-ultimate-lora-collection.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 2,
    type: 'lora',
  },

  'artaug-flux-enhancement-lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 2,
    type: 'lora',
  },

  'flux-canny-dev-lora.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 2,
    type: 'lora',
  },

  // Community and Experimental LoRA (Priority 3 - Community)
  'watercolor_painting_schnell_lora.safetensors': {
    compatibleVariants: ['schnell'],
    modelFamily: 'FLUX',
    priority: 3,
    type: 'lora',
  },

  'juggernaut_lora_flux.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 3,
    type: 'lora',
  },

  'chinese-style-flux-lora-collection.safetensors': {
    compatibleVariants: ['dev'],
    modelFamily: 'FLUX',
    priority: 3,
    type: 'lora',
  },

  'flux-medical-environment-lora.safetensors': {
    compatibleVariants: ['kontext'],
    modelFamily: 'FLUX',
    priority: 3,
    type: 'lora',
  },

  'flux-fill-object-removal.safetensors': {
    compatibleVariants: ['kontext'],
    modelFamily: 'FLUX',
    priority: 3,
    type: 'lora',
  },

  // ===================================================================
  // === CONTROLNET MODELS ===
  // ===================================================================

  // XLabs-AI Official FLUX ControlNet Models (Priority 1 - Official)
  'flux-controlnet-canny-v3.safetensors': {
    compatibleVariants: ['dev'],
    controlnetType: 'canny',
    modelFamily: 'FLUX',
    priority: 1,
    type: 'controlnet',
  },

  'flux-controlnet-depth-v3.safetensors': {
    compatibleVariants: ['dev'],
    controlnetType: 'depth',
    modelFamily: 'FLUX',
    priority: 1,
    type: 'controlnet',
  },

  'flux-controlnet-hed-v3.safetensors': {
    compatibleVariants: ['dev'],
    controlnetType: 'hed',
    modelFamily: 'FLUX',
    priority: 1,
    type: 'controlnet',
  },
} as const;
/* eslint-enable sort-keys-fix/sort-keys-fix */

/**
 * Get all components with names matching filters
 */
export function getAllComponentsWithNames(options?: {
  compatibleVariant?: string;
  controlnetType?: ComponentConfig['controlnetType'];
  modelFamily?: ComponentConfig['modelFamily'];
  priority?: number;
  type?: ComponentConfig['type'];
}): Array<{ config: ComponentConfig; name: string }> {
  return Object.entries(SYSTEM_COMPONENTS)
    .filter(
      ([, config]) =>
        (!options?.type || config.type === options.type) &&
        (!options?.priority || config.priority === options.priority) &&
        (!options?.modelFamily || config.modelFamily === options.modelFamily) &&
        (!options?.compatibleVariant ||
          (config.compatibleVariants &&
            config.compatibleVariants.includes(options.compatibleVariant))) &&
        (!options?.controlnetType || config.controlnetType === options.controlnetType),
    )
    .map(([name, config]) => ({ config, name }));
}

/**
 * Get optimal component of specified type
 */
export function getOptimalComponent(
  type: ComponentConfig['type'],
  modelFamily: ComponentConfig['modelFamily'],
): string {
  const components = getAllComponentsWithNames({ modelFamily, type }).sort(
    (a, b) => a.config.priority - b.config.priority,
  );

  if (components.length === 0) {
    throw new ConfigError(
      `No ${type} components configured for model family ${modelFamily}`,
      ConfigError.Reasons.MISSING_CONFIG,
      { modelFamily, type },
    );
  }

  return components[0].name;
}
