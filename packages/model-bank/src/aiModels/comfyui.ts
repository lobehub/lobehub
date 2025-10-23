import { ModelParamsSchema, PRESET_ASPECT_RATIOS } from '../standard-parameters';
import { AIImageModelCard } from '../types';

/**
 * Aspect ratios supported by FLUX models
 * Support wide range ratios from 21:9 to 9:21, including foldable screen devices
 */
const FLUX_ASPECT_RATIOS = [
  '21:9', // Ultra-wide screen
  '16:9', // Widescreen
  '8:7', // Foldable screen (e.g. Galaxy Z Fold, unfolded state ~7.6 inch)
  '4:3', // Traditional landscape
  '3:2', // Classic landscape
  '1:1', // Square
  '2:3', // Classic portrait
  '3:4', // Traditional portrait
  '7:8', // Foldable screen portrait
  '9:16', // Portrait
  '9:21', // Ultra-tall portrait
];

/**
 * Standard aspect ratios supported by SD models
 * Based on preset aspect ratios, suitable for traditional SD model use cases
 */
const SD_ASPECT_RATIOS = PRESET_ASPECT_RATIOS;

/**
 * Extended aspect ratios supported by SDXL models
 * Support more modern display ratios, similar to FLUX but more conservative
 */
const SDXL_ASPECT_RATIOS = [
  '16:9', // Modern widescreen
  '4:3', // Traditional landscape
  '3:2', // Classic landscape
  '1:1', // Square
  '2:3', // Classic portrait
  '3:4', // Traditional portrait
  '9:16', // Modern portrait
];

/**
 * FLUX.1 Schnell model parameter configuration
 * Ultra-fast text-to-image mode, generates in 1-4 steps, Apache 2.0 license
 */
export const fluxSchnellParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: FLUX_ASPECT_RATIOS,
  },
  cfg: { default: 1, max: 1, min: 1, step: 0 }, // Schnell uses fixed CFG of 1
  height: { default: 1024, max: 1536, min: 512, step: 8 },
  prompt: { default: '' },
  samplerName: { default: 'euler' },
  scheduler: { default: 'simple' },
  seed: { default: null },
  steps: { default: 4, max: 4, min: 1, step: 1 },
  width: { default: 1024, max: 1536, min: 512, step: 8 },
};

/**
 * FLUX.1 Dev model parameter configuration
 * High-quality text-to-image mode, supports guidance scale adjustment, non-commercial license
 */
export const fluxDevParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: FLUX_ASPECT_RATIOS,
  },
  cfg: { default: 3.5, max: 10, min: 1, step: 0.5 },
  height: { default: 1024, max: 2048, min: 512, step: 8 },
  prompt: { default: '' },
  samplerName: { default: 'euler' },
  scheduler: { default: 'simple' },
  seed: { default: null },
  steps: { default: 20, max: 50, min: 10, step: 1 },
  width: { default: 1024, max: 2048, min: 512, step: 8 },
};

/**
 * FLUX.1 Krea-dev model parameter configuration
 * Enhanced safety text-to-image mode, developed in collaboration with Krea, non-commercial license
 */
export const fluxKreaDevParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: FLUX_ASPECT_RATIOS,
  },
  cfg: { default: 3.5, max: 10, min: 1, step: 0.5 },
  height: { default: 1024, max: 2048, min: 512, step: 8 },
  prompt: { default: '' },
  samplerName: { default: 'dpmpp_2m_sde' },
  scheduler: { default: 'karras' },
  seed: { default: null },
  steps: { default: 15, max: 50, min: 10, step: 1 },
  width: { default: 1024, max: 2048, min: 512, step: 8 },
};

/**
 * FLUX.1 Kontext-dev model parameter configuration
 * Image editing mode, supports modifying existing images based on text instructions, non-commercial license
 */
export const fluxKontextDevParamsSchema: ModelParamsSchema = {
  cfg: { default: 3.5, max: 10, min: 1, step: 0.5 },
  imageUrl: { default: '' }, // Input image URL (supports text-to-image and image-to-image)
  prompt: { default: '' },
  seed: { default: null },
  steps: { default: 28, max: 50, min: 10, step: 1 }, // Kontext defaults to 28 steps
  strength: { default: 0.85, max: 1, min: 0, step: 0.05 }, // Image editing strength control (frontend parameter)
};

/**
 * SD3.5 model parameter configuration
 * Stable Diffusion 3.5, supports Large and Medium versions, automatically selects by priority
 */
export const sd35ParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: FLUX_ASPECT_RATIOS, // SD3.5 also supports multiple aspect ratios
  },
  cfg: { default: 4, max: 20, min: 1, step: 0.5 },
  height: { default: 1024, max: 2048, min: 512, step: 8 },
  prompt: { default: '' },
  samplerName: { default: 'euler' },
  scheduler: { default: 'sgm_uniform' },
  seed: { default: null },
  steps: { default: 20, max: 50, min: 10, step: 1 },
  width: { default: 1024, max: 2048, min: 512, step: 8 },
};

/**
 * SD1.5 text-to-image model parameter configuration
 * Stable Diffusion 1.5 text-to-image generation, suitable for 512x512 resolution
 */
export const sd15T2iParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: SD_ASPECT_RATIOS,
  },
  cfg: { default: 7, max: 20, min: 1, step: 0.5 },
  height: { default: 512, max: 1024, min: 256, step: 8 },
  prompt: { default: '' },
  samplerName: { default: 'euler' },
  scheduler: { default: 'normal' },
  seed: { default: null },
  steps: { default: 25, max: 50, min: 10, step: 1 },
  width: { default: 512, max: 1024, min: 256, step: 8 },
};

/**
 * SDXL text-to-image model parameter configuration
 * SDXL text-to-image generation, suitable for 1024x1024 resolution
 */
export const sdxlT2iParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: SDXL_ASPECT_RATIOS,
  },
  cfg: { default: 8, max: 20, min: 1, step: 0.5 },
  height: { default: 1024, max: 2048, min: 512, step: 8 },
  prompt: { default: '' },
  samplerName: { default: 'euler' },
  scheduler: { default: 'normal' },
  seed: { default: null },
  steps: { default: 30, max: 50, min: 10, step: 1 },
  width: { default: 1024, max: 2048, min: 512, step: 8 },
};

/**
 * SDXL image-to-image model parameter configuration
 * SDXL image-to-image generation, supports input image modification
 */
export const sdxlI2iParamsSchema: ModelParamsSchema = {
  cfg: { default: 8, max: 20, min: 1, step: 0.5 },
  imageUrl: { default: '' }, // Input image URL
  prompt: { default: '' },
  samplerName: { default: 'euler' },
  scheduler: { default: 'normal' },
  seed: { default: null },
  steps: { default: 30, max: 50, min: 10, step: 1 },
  strength: { default: 0.75, max: 1, min: 0, step: 0.05 }, // Image modification strength (frontend parameter)
};

/**
 * Custom SD text-to-image model parameter configuration
 * Custom Stable Diffusion text-to-image model with flexible parameter settings
 */
export const customSdT2iParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: SDXL_ASPECT_RATIOS, // Use broader aspect ratio support
  },
  cfg: { default: 7, max: 30, min: 1, step: 0.5 },
  height: { default: 768, max: 2048, min: 256, step: 8 },
  prompt: { default: '' },
  samplerName: { default: 'euler' }, // Use SDXL common parameters
  scheduler: { default: 'normal' }, // Use SDXL common parameters
  seed: { default: null },
  steps: { default: 25, max: 100, min: 5, step: 1 },
  width: { default: 768, max: 2048, min: 256, step: 8 },
};

/**
 * Custom SD image-to-image model parameter configuration
 * Custom Stable Diffusion image-to-image model, supports image editing
 */
export const customSdI2iParamsSchema: ModelParamsSchema = {
  cfg: { default: 7, max: 30, min: 1, step: 0.5 },
  imageUrl: { default: '' }, // Input image URL
  prompt: { default: '' },
  samplerName: { default: 'euler' }, // Use SDXL common parameters
  scheduler: { default: 'normal' }, // Use SDXL common parameters
  seed: { default: null },
  steps: { default: 25, max: 100, min: 5, step: 1 },
  strength: { default: 0.75, max: 1, min: 0, step: 0.05 }, // Image modification strength (frontend parameter)
};

/**
 * List of image generation models supported by ComfyUI
 * Supports FLUX series and Stable Diffusion 3.5 models
 */
const comfyuiImageModels: AIImageModelCard[] = [
  {
    description:
      'FLUX.1 Schnell - 超快速文生图模型，1-4步即可生成高质量图像，适合实时应用和快速原型制作',
    displayName: 'FLUX.1 Schnell',
    enabled: true,
    id: 'comfyui/flux-schnell',
    parameters: fluxSchnellParamsSchema,
    releasedAt: '2024-08-01',
    type: 'image',
  },
  {
    description: 'FLUX.1 Dev - 高质量文生图模型，10-50步生成，适合高质量创作和艺术作品生成',
    displayName: 'FLUX.1 Dev',
    enabled: true,
    id: 'comfyui/flux-dev',
    parameters: fluxDevParamsSchema,
    releasedAt: '2024-08-01',
    type: 'image',
  },
  {
    description: 'FLUX.1 Krea-dev - 增强安全的文生图模型，与 Krea 合作开发，内置安全过滤',
    displayName: 'FLUX.1 Krea-dev',
    enabled: false,
    id: 'comfyui/flux-krea-dev',
    parameters: fluxKreaDevParamsSchema,
    releasedAt: '2025-07-31',
    type: 'image',
  },
  {
    description:
      'FLUX.1 Kontext-dev - 图像编辑模型，支持基于文本指令修改现有图像，支持局部修改和风格迁移',
    displayName: 'FLUX.1 Kontext-dev',
    enabled: true,
    id: 'comfyui/flux-kontext-dev',
    parameters: fluxKontextDevParamsSchema,
    releasedAt: '2025-05-29', // Aligned with BFL official Kontext series release date
    type: 'image',
  },
  {
    description:
      'Stable Diffusion 3.5 新一代文生图模型，支持 Large 和 Medium 两个版本，需要外部 CLIP 编码器文件，提供卓越的图像质量和提示词匹配度。',
    displayName: 'Stable Diffusion 3.5',
    enabled: true,
    id: 'comfyui/stable-diffusion-35',
    parameters: sd35ParamsSchema,
    releasedAt: '2024-10-22',
    type: 'image',
  },
  {
    description:
      'Stable Diffusion 3.5 内置 CLIP/T5 编码器版本，无需外部编码器文件，适用于 sd3.5_medium_incl_clips 等模型，资源占用更少。',
    displayName: 'Stable Diffusion 3.5 (内置编码器)',
    enabled: false,
    id: 'comfyui/stable-diffusion-35-inclclip',
    parameters: sd35ParamsSchema,
    releasedAt: '2024-10-22',
    type: 'image',
  },
  {
    description:
      'Stable Diffusion 1.5 文生图模型，经典的512x512分辨率文本到图像生成，适合快速原型和创意实验',
    displayName: 'SD 1.5',
    enabled: false,
    id: 'comfyui/stable-diffusion-15',
    parameters: sd15T2iParamsSchema,
    releasedAt: '2022-08-22',
    type: 'image',
  },
  {
    description:
      'SDXL 文生图模型，支持1024x1024高分辨率文本到图像生成，提供更好的图像质量和细节表现',
    displayName: 'SDXL 文生图',
    enabled: true,
    id: 'comfyui/stable-diffusion-xl',
    parameters: sdxlT2iParamsSchema,
    releasedAt: '2023-07-26',
    type: 'image',
  },
  {
    description:
      'SDXL 图生图模型，基于输入图像进行高质量的图像到图像转换，支持风格迁移、图像修复和创意变换。',
    displayName: 'SDXL Refiner',
    enabled: true,
    id: 'comfyui/stable-diffusion-refiner',
    parameters: sdxlI2iParamsSchema,
    releasedAt: '2023-07-26',
    type: 'image',
  },
  {
    description:
      '自定义 SD 文生图模型，模型文件名请使用 custom_sd_lobe.safetensors，如有 VAE 请使用 custom_sd_vae_lobe.safetensors，模型文件需要按照 Comfy 的要求放入对应文件夹',
    displayName: '自定义 SD 文生图',
    enabled: false,
    id: 'comfyui/stable-diffusion-custom',
    parameters: customSdT2iParamsSchema,
    releasedAt: '2023-01-01',
    type: 'image',
  },
  {
    description:
      '自定义 SDXL 图生图模型，模型文件名请使用 custom_sd_lobe.safetensors，如有 VAE 请使用 custom_sd_vae_lobe.safetensors，模型文件需要按照 Comfy 的要求放入对应文件夹',
    displayName: '自定义 SDXL Refiner',
    enabled: false,
    id: 'comfyui/stable-diffusion-custom-refiner',
    parameters: customSdI2iParamsSchema,
    releasedAt: '2023-01-01',
    type: 'image',
  },
];

export const allModels = [...comfyuiImageModels];

export default allModels;
