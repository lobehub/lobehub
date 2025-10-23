/**
 * ComfyUI framework constants configuration
 * Unified management of hardcoded values with environment variable overrides / 统一管理硬编码值，支持环境变量覆盖
 */

/**
 * Default configuration / 默认配置
 * 注意：BASE_URL不再处理环境变量，由构造函数统一处理优先级
 */
export const COMFYUI_DEFAULTS = {
  BASE_URL: 'http://localhost:8000',
  CONNECTION_TIMEOUT: 30_000,
  MAX_RETRIES: 3,
} as const;

/**
 * FLUX model configuration / FLUX 模型配置
 * Removed over-engineered dynamic T5 selection, maintain simple fixed configuration / 移除过度工程化的动态T5选择，保持简单固定配置
 */
export const FLUX_MODEL_CONFIG = {
  FILENAME_PREFIXES: {
    DEV: 'LobeChat/%year%-%month%-%day%/FLUX_Dev',
    KONTEXT: 'LobeChat/%year%-%month%-%day%/FLUX_Kontext',
    KREA: 'LobeChat/%year%-%month%-%day%/FLUX_Krea',
    SCHNELL: 'LobeChat/%year%-%month%-%day%/FLUX_Schnell',
  },
} as const;

/**
 * SD model configuration
 * Fixed model and filename prefixes for SD models
 */
export const SD_MODEL_CONFIG = {
  FILENAME_PREFIXES: {
    CUSTOM: 'LobeChat/%year%-%month%-%day%/CustomSD',
    SD15: 'LobeChat/%year%-%month%-%day%/SD15',
    SD35: 'LobeChat/%year%-%month%-%day%/SD35',
    SDXL: 'LobeChat/%year%-%month%-%day%/SDXL',
  },
} as const;

/**
 * Default workflow node parameters / 工作流节点默认参数
 * Based on 2024 community best practices configuration / 基于 2024 年社区最佳实践配置
 */

/**
 * Essential workflow defaults for internal use only
 * These are hardcoded values used by workflow internals, not user-configurable parameters
 */
export const WORKFLOW_DEFAULTS = {
  // FLUX specific settings
  FLUX: {
    BASE_SHIFT: 0.5,
    CLIP_GUIDANCE: 1,
    SAMPLER: 'euler',
    SCHEDULER: 'simple', // Higher denoise for Kontext img2img
  },
  // Image dimensions and batch settings
  IMAGE: {
    BATCH_SIZE: 1, // workflow internal use
  },
  // Internal noise and sampling settings
  SAMPLING: {
    DENOISE: 1, // t2i mode internal use
    MAX_SHIFT: 1.15, // FLUX internal parameter
  },
  // SD3.5 specific internal settings
  SD3: {
    SHIFT: 3, // SD3.5 ModelSamplingSD3 internal parameter
  },
} as const;

/**
 * Default negative prompt for all SD models
 */
export const DEFAULT_NEGATIVE_PROMPT = `worst quality, normal quality, low quality, low res, blurry, distortion, text, watermark, logo, banner, extra digits, cropped, jpeg artifacts, signature, username, error, sketch, duplicate, ugly, monochrome, horror, geometry, mutation, disgusting, bad anatomy, bad proportions, bad quality, deformed, disconnected limbs, out of frame, out of focus, dehydrated, disfigured, extra arms, extra limbs, extra hands, fused fingers, gross proportions, long neck, jpeg, malformed limbs, mutated, mutated hands, mutated limbs, missing arms, missing fingers, picture frame, poorly drawn hands, poorly drawn face, collage, pixel, pixelated, grainy, color aberration, amputee, autograph, bad illustration, beyond the borders, blank background, body out of frame, boring background, branding, cut off, dismembered, disproportioned, distorted, draft, duplicated features, extra fingers, extra legs, fault, flaw, grains, hazy, identifying mark, improper scale, incorrect physiology, incorrect ratio, indistinct, kitsch, low resolution, macabre, malformed, mark, misshapen, missing hands, missing legs, mistake, morbid, mutilated, off-screen, outside the picture, poorly drawn feet, printed words, render, repellent, replicate, reproduce, revolting dimensions, script, shortened, sign, split image, squint, storyboard, tiling, trimmed, unfocused, unattractive, unnatural pose, unreal engine, unsightly, written language`;

/**
 * Supported model file formats
 * Used for model file validation and detection
 */
export const SUPPORTED_MODEL_FORMATS = [
  '.safetensors',
  '.ckpt',
  '.pt',
  '.pth',
  '.bin',
  '.gguf', // GGUF format for quantized models
] as const;

/**
 * Custom SD model configuration
 * Fixed model and VAE filenames for custom SD models
 */
export const CUSTOM_SD_CONFIG = {
  MODEL_FILENAME: 'custom_sd_lobe.safetensors', // Both custom models use same file
  VAE_FILENAME: 'custom_sd_vae_lobe.safetensors', // Optional VAE file
} as const;

/**
 * Component to ComfyUI node mappings
 * Maps component types to their corresponding ComfyUI loader nodes and input fields
 */
export const COMPONENT_NODE_MAPPINGS: Record<string, { field: string; node: string }> = {
  clip: { field: 'clip_name', node: 'CLIPLoader' },
  t5: { field: 'clip_name', node: 'CLIPLoader' }, // T5 is also CLIP type
  vae: { field: 'vae_name', node: 'VAELoader' },
  // Main models (UNET) are fetched via getCheckpoints(), not here
} as const;
