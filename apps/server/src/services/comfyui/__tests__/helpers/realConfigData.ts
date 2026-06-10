/**
 * Real configuration data helper for tests
 * Uses actual data from configuration files instead of mock data
 */
import { MODEL_REGISTRY } from '@/server/services/comfyui/config/modelRegistry';
import { SYSTEM_COMPONENTS } from '@/server/services/comfyui/config/systemComponents';
import { getModelConfig } from '@/server/services/comfyui/utils/staticModelLookup';

// Export real model entries for tests
export const REAL_MODEL_ENTRIES = Object.entries(MODEL_REGISTRY);

// Get real FLUX models
export const REAL_FLUX_MODELS = REAL_MODEL_ENTRIES.filter(
  ([, config]) => config.modelFamily === 'FLUX',
).map(([fileName]) => fileName);

// Get real SD models
export const REAL_SD_MODELS = REAL_MODEL_ENTRIES.filter(([, config]) =>
  ['SD1', 'SDXL', 'SD3'].includes(config.modelFamily),
).map(([fileName]) => fileName);

// Get real system components
export const REAL_COMPONENT_ENTRIES = Object.entries(SYSTEM_COMPONENTS);

// Get real FLUX components
export const REAL_FLUX_COMPONENTS = {
  clip: REAL_COMPONENT_ENTRIES.filter(
    ([, config]) => config.type === 'clip' && config.modelFamily === 'FLUX',
  ).map(([name]) => name),
  t5: REAL_COMPONENT_ENTRIES.filter(
    ([, config]) => config.type === 't5' && config.modelFamily === 'FLUX',
  ).map(([name]) => name),
  vae: REAL_COMPONENT_ENTRIES.filter(
    ([, config]) => config.type === 'vae' && config.modelFamily === 'FLUX',
  ).map(([name]) => name),
};

// Get real SD components
export const REAL_SD_COMPONENTS = {
  clip: REAL_COMPONENT_ENTRIES.filter(
    ([, config]) => config.type === 'clip' && ['SD1', 'SDXL', 'SD3'].includes(config.modelFamily),
  ).map(([name]) => name),
  vae: REAL_COMPONENT_ENTRIES.filter(
    ([, config]) => config.type === 'vae' && ['SD1', 'SDXL', 'SD3'].includes(config.modelFamily),
  ).map(([name]) => name),
};

// Export real workflow defaults

// Export real component node mappings

// Helper to get real model config
export const getRealModelConfig = getModelConfig;

// Test data selections (using real data)
export const TEST_MODELS = {
  flux: REAL_FLUX_MODELS[0] || 'flux1-dev.safetensors', // Use first real FLUX model
  sd35:
    REAL_SD_MODELS.find((m) => getRealModelConfig(m)?.modelFamily === 'SD3') ||
    'sd3.5_large.safetensors',
  sdxl:
    REAL_SD_MODELS.find((m) => getRealModelConfig(m)?.modelFamily === 'SDXL') ||
    'sdxl_base.safetensors',
};

export const TEST_COMPONENTS = {
  flux: {
    clip: REAL_FLUX_COMPONENTS.clip[0] || 'clip_l.safetensors',
    t5: REAL_FLUX_COMPONENTS.t5[0] || 't5xxl_fp16.safetensors',
    vae: REAL_FLUX_COMPONENTS.vae[0] || 'ae.safetensors',
  },
  sd: {
    clip: REAL_SD_COMPONENTS.clip[0] || 'clip_g.safetensors',
    vae: REAL_SD_COMPONENTS.vae[0] || 'sdxl_vae_fp16fix.safetensors',
  },
};
export {
  COMPONENT_NODE_MAPPINGS as REAL_COMPONENT_MAPPINGS,
  WORKFLOW_DEFAULTS as REAL_WORKFLOW_DEFAULTS,
} from '@/server/services/comfyui/config/constants';
