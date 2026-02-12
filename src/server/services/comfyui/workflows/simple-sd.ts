/**
 * Simple SD Workflow
 *
 * Universal workflow for all Stable Diffusion models using CheckpointLoaderSimple
 * Supports SD1.5, SDXL, SD3.5 and other models with built-in encoders
 * E.g., sd3.5_medium_incl_clips_t5xxlfp8scaled.safetensors, sd_xl_base_1.0.safetensors
 *
 * Features:
 * - Dynamic text-to-image (t2i) and image-to-image (i2i) mode switching
 * - Automatic node connection based on input parameters
 * - Backward compatibility with existing API calls
 */
import { generateUniqueSeeds } from '@lobechat/utils';
import { PromptBuilder } from '@saintno/comfyui-sdk';

import {
  CUSTOM_SD_CONFIG,
  DEFAULT_NEGATIVE_PROMPT,
  WORKFLOW_DEFAULTS,
} from '@/server/services/comfyui/config/constants';
import { type ModelConfig } from '@/server/services/comfyui/config/modelRegistry';
import { type WorkflowContext } from '@/server/services/comfyui/core/workflowBuilderService';
import { getModelConfig } from '@/server/services/comfyui/utils/staticModelLookup';
import { getWorkflowFilenamePrefix } from '@/server/services/comfyui/utils/workflowUtils';

/**
 * Parameters for SimpleSD workflow
 */
export interface SimpleSDParams extends Record<string, any> {
  cfg?: number; // Guidance scale for generation
  denoise?: number; // Denoising strength for i2i mode (0.0 - 1.0, default: 0.75)
  height?: number; // Image height
  imageUrl?: string; // Frontend parameter: Input image URL for i2i mode
  imageUrls?: string[]; // Alternative: Array of image URLs (uses first one)
  inputImage?: string; // Internal parameter: Input image URL/path for i2i mode
  prompt?: string; // Text prompt for generation
  samplerName?: string; // Sampling algorithm (default: 'euler')
  scheduler?: string; // Noise scheduler (default: varies by model type)
  seed?: number; // Random seed for generation
  steps?: number; // Number of denoising steps
  strength?: number; // Frontend parameter: Image modification strength (maps to denoise)
  width?: number; // Image width
}

/**
 * @param modelConfig - Model configuration from registry
 * @returns Whether to attach external VAE
 */
/**
 * Determine if external VAE should be attached based on model configuration
 *
 * - SD3 family models (sd35-inclclip) have built-in VAE - don't attach external
 * - SD1/SDXL models need external VAE - should attach if available
 * - Custom SD models are handled separately with their own VAE logic
 *
 * @param modelConfig - Model configuration from registry
 * @returns Whether to attach external VAE
 */
function shouldAttachVAE(modelConfig: ModelConfig | null): boolean {
  if (!modelConfig) return false;

  // SD3 family models (including sd35-inclclip) have built-in VAE
  if (modelConfig.modelFamily === 'SD3') {
    return false;
  }

  // SD1 and SDXL models typically need external VAE
  return modelConfig.modelFamily === 'SD1' || modelConfig.modelFamily === 'SDXL';
}

/**
 * Build Simple SD workflow for models with CheckpointLoaderSimple compatibility
 * Universal workflow supporting SD1.5, SDXL, SD3.5 and other Stable Diffusion variants
 *
 * @param modelFileName - The checkpoint model filename
 * @param params - Generation parameters with optional mode and inputImage
 * @param context - Workflow context with service layer access
 * @returns PromptBuilder configured for the specified mode
 */
export async function buildSimpleSDWorkflow(
  modelFileName: string,
  params: SimpleSDParams,
  context: WorkflowContext,
): Promise<PromptBuilder<any, any, any>> {
  // Determine if we're in image-to-image mode based on presence of input image
  const isI2IMode = Boolean(params.imageUrl || params.imageUrls?.[0]);

  // Get model configuration to determine VAE handling and default parameters
  const modelConfig = getModelConfig(modelFileName) || null;

  // Get optimal VAE - business logic in workflow layer
  let selectedVAE: string | undefined;

  // Determine if this is a custom SD model by checking the filename
  const isCustomSD = modelFileName === CUSTOM_SD_CONFIG.MODEL_FILENAME;

  // VAE selection logic:
  // 1. Custom SD models: Try to use the configured custom VAE file if it exists
  //    If not available, fall back to built-in VAE (selectedVAE remains undefined)
  if (isCustomSD && context?.modelResolverService) {
    const fixedVAEFileName = CUSTOM_SD_CONFIG.VAE_FILENAME;
    const serverVAEs = await context.modelResolverService.getAvailableVAEFiles();

    if (serverVAEs.includes(fixedVAEFileName)) {
      selectedVAE = fixedVAEFileName;
    }
    // If custom VAE not found, use built-in VAE (selectedVAE remains undefined)
  }
  // 2. Non-custom models: Try to find optimal VAE based on model family
  else if (shouldAttachVAE(modelConfig) && context?.modelResolverService) {
    selectedVAE = await context.modelResolverService.getOptimalComponent(
      'vae',
      modelConfig!.modelFamily,
    );
  }
  // If no VAE found or it's SD3, use built-in VAE (selectedVAE remains undefined)

  // Base workflow for models with built-in CLIP/T5 encoders
  /* eslint-disable sort-keys-fix/sort-keys-fix */
  const workflow: any = {
    '1': {
      _meta: { title: 'Load Checkpoint' },
      class_type: 'CheckpointLoaderSimple',
      inputs: {
        ckpt_name: modelFileName,
      },
    },
    '2': {
      _meta: { title: 'Positive Prompt' },
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['1', 1], // Use checkpoint's built-in CLIP
        text: params.prompt,
      },
    },
    '3': {
      _meta: { title: 'Negative Prompt' },
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['1', 1], // Use checkpoint's built-in CLIP
        text: DEFAULT_NEGATIVE_PROMPT,
      },
    },
    '5': {
      _meta: { title: 'KSampler' },
      class_type: 'KSampler',
      inputs: {
        cfg: params.cfg,
        denoise: isI2IMode ? params.strength : WORKFLOW_DEFAULTS.SAMPLING.DENOISE,
        latent_image: isI2IMode ? ['9', 0] : ['4', 0], // Dynamic connection based on mode
        model: ['1', 0],
        negative: ['3', 0],
        positive: ['2', 0],
        sampler_name: params.samplerName,
        scheduler: params.scheduler,
        seed: params.seed ?? generateUniqueSeeds(1)[0],
        steps: params.steps,
      },
    },
    '6': {
      _meta: { title: 'VAE Decode' },
      class_type: 'VAEDecode',
      inputs: {
        samples: ['5', 0],
        vae: selectedVAE ? ['VAE_LOADER', 0] : ['1', 2], // Use external or built-in VAE
      },
    },
    '7': {
      _meta: { title: 'Save Image' },
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: getWorkflowFilenamePrefix('buildSimpleSDWorkflow', context.variant),
        images: ['6', 0],
      },
    },
  };
  /* eslint-enable sort-keys-fix/sort-keys-fix */

  // Add VAE Loader node if using external VAE
  if (selectedVAE) {
    workflow['VAE_LOADER'] = {
      _meta: { title: 'VAE Loader' },
      class_type: 'VAELoader',
      inputs: {
        vae_name: selectedVAE,
      },
    };
  }

  // Add dynamic nodes based on mode
  if (isI2IMode) {
    // Image-to-image mode: Add LoadImage and VAEEncode nodes
    workflow['8'] = {
      _meta: { title: 'Load Input Image' },
      class_type: 'LoadImage',
      inputs: {
        image: params.imageUrl || params.imageUrls?.[0] || '',
      },
    };

    workflow['9'] = {
      _meta: { title: 'VAE Encode Input' },
      class_type: 'VAEEncode',
      inputs: {
        pixels: ['8', 0],
        vae: selectedVAE ? ['VAE_LOADER', 0] : ['1', 2], // Use external or built-in VAE
      },
    };
  } else {
    // Text-to-image mode: Add EmptyLatentImage node
    workflow['4'] = {
      _meta: { title: 'Empty Latent' },
      class_type: 'EmptyLatentImage',
      inputs: {
        batch_size: WORKFLOW_DEFAULTS.IMAGE.BATCH_SIZE,
        height: params.height,
        width: params.width,
      },
    };
  }

  // Create dynamic input parameters list
  const inputParams = isI2IMode
    ? ['prompt', 'steps', 'seed', 'cfg', 'samplerName', 'scheduler', 'inputImage', 'denoise'] // i2i mode: no width/height needed (uses input image dimensions automatically)
    : ['prompt', 'width', 'height', 'steps', 'seed', 'cfg', 'samplerName', 'scheduler']; // t2i mode: width/height required

  // Create PromptBuilder
  const builder = new PromptBuilder(workflow, inputParams, ['images']);

  // Set output node
  builder.setOutputNode('images', '7');

  // Set input node mappings
  builder.setInputNode('prompt', '2.inputs.text');
  builder.setInputNode('steps', '5.inputs.steps');
  builder.setInputNode('seed', '5.inputs.seed');
  builder.setInputNode('cfg', '5.inputs.cfg');
  builder.setInputNode('samplerName', '5.inputs.sampler_name');
  builder.setInputNode('scheduler', '5.inputs.scheduler');

  // Mode-specific mappings
  if (isI2IMode) {
    // Image-to-image mode: input image and denoise
    builder.setInputNode('inputImage', '8.inputs.image');
    builder.setInputNode('denoise', '5.inputs.denoise');
  } else {
    // Text-to-image mode: width and height
    builder.setInputNode('width', '4.inputs.width');
    builder.setInputNode('height', '4.inputs.height');
  }

  // Set input values
  builder
    .input('prompt', params.prompt)
    .input('steps', params.steps)
    .input('seed', params.seed ?? generateUniqueSeeds(1)[0])
    .input('cfg', params.cfg)
    .input('samplerName', params.samplerName)
    .input('scheduler', params.scheduler);

  // Mode-specific input values
  if (isI2IMode) {
    // Image-to-image mode: no width/height needed (KSampler uses input image dimensions automatically)
    builder.input('inputImage', params.imageUrl || params.imageUrls?.[0]);
    builder.input('denoise', params.strength);
  } else {
    // Text-to-image mode: width/height required for EmptyLatentImage
    builder.input('width', params.width);
    builder.input('height', params.height);
  }

  return builder;
}
