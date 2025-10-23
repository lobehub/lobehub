import { generateUniqueSeeds } from '@lobechat/utils';
import { PromptBuilder } from '@saintno/comfyui-sdk';

import { WORKFLOW_DEFAULTS } from '@/server/services/comfyui/config/constants';
import type { WorkflowContext } from '@/server/services/comfyui/core/workflowBuilderService';
import { splitPromptForDualCLIP } from '@/server/services/comfyui/utils/promptSplitter';
import { selectOptimalWeightDtype } from '@/server/services/comfyui/utils/weightDType';
import { getWorkflowFilenamePrefix } from '@/server/services/comfyui/utils/workflowUtils';

/**
 * FLUX Dev Workflow Builder
 *
 * @description Builds 20-step high-quality generation workflow with FluxGuidance and SamplerCustomAdvanced
 *
 * @param {string} modelFileName - Model filename
 * @param {Record<string, any>} params - Generation parameters
 * @param {WorkflowContext} context - Workflow context
 * @returns {PromptBuilder<any, any, any>} Built workflow
 */
export async function buildFluxDevWorkflow(
  modelFileName: string,
  params: Record<string, any>,
  context: WorkflowContext,
): Promise<PromptBuilder<any, any, any>> {
  // Get required components - will throw if not available (workflow cannot run without them)
  const selectedT5Model = await context.modelResolverService.getOptimalComponent('t5', 'FLUX');
  const selectedVAE = await context.modelResolverService.getOptimalComponent('vae', 'FLUX');
  const selectedCLIP = await context.modelResolverService.getOptimalComponent('clip', 'FLUX');

  // Process prompt splitting early in workflow construction
  const { t5xxlPrompt, clipLPrompt } = splitPromptForDualCLIP(params.prompt);

  /* eslint-disable sort-keys-fix/sort-keys-fix */
  const workflow = {
    '1': {
      _meta: {
        title: 'DualCLIP Loader',
      },
      class_type: 'DualCLIPLoader',
      inputs: {
        clip_name1: selectedT5Model,
        clip_name2: selectedCLIP,
        type: 'flux',
      },
    },
    '10': {
      _meta: {
        title: 'Sampler Custom Advanced',
      },
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        guider: ['14', 0], // ✅ BasicGuider provides GUIDER type (handles model/conditioning)
        latent_image: ['7', 0], // Empty latent image for txt2img
        noise: ['13', 0], // Random noise for initialization
        sampler: ['8', 0], // Sampling algorithm (euler)
        sigmas: ['9', 0], // Noise schedule from BasicScheduler
      },
    },
    '11': {
      _meta: {
        title: 'VAE Decode',
      },
      class_type: 'VAEDecode',
      inputs: {
        samples: ['10', 0],
        vae: ['3', 0],
      },
    },
    '12': {
      _meta: {
        title: 'Save Image',
      },
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: getWorkflowFilenamePrefix('buildFluxDevWorkflow', context.variant),
        images: ['11', 0],
      },
    },
    '13': {
      _meta: {
        title: 'Random Noise',
      },
      class_type: 'RandomNoise',
      inputs: {
        noise_seed: 0,
      },
    },
    '14': {
      _meta: {
        title: 'Basic Guider',
      },
      class_type: 'BasicGuider',
      inputs: {
        conditioning: ['6', 0], // FluxGuidance conditioning output
        model: ['4', 0], // ModelSamplingFlux model
      },
    },
    '2': {
      _meta: {
        title: 'UNET Loader',
      },
      class_type: 'UNETLoader',
      inputs: {
        unet_name: modelFileName,
        weight_dtype: selectOptimalWeightDtype(modelFileName),
      },
    },
    '3': {
      _meta: {
        title: 'VAE Loader',
      },
      class_type: 'VAELoader',
      inputs: {
        vae_name: selectedVAE,
      },
    },
    '4': {
      _meta: {
        title: 'Model Sampling Flux',
      },
      class_type: 'ModelSamplingFlux',
      inputs: {
        base_shift: 0.5, // Required parameter for FLUX models
        height: params.height,
        max_shift: WORKFLOW_DEFAULTS.SAMPLING.MAX_SHIFT,
        model: ['2', 0],
        width: params.width,
      },
    },
    '5': {
      _meta: {
        title: 'CLIP Text Encode (Flux)',
      },
      class_type: 'CLIPTextEncodeFlux',
      inputs: {
        clip: ['1', 0],
        clip_l: '',
        guidance: params.cfg,
        t5xxl: '',
      },
    },
    '6': {
      _meta: {
        title: 'Flux Guidance',
      },
      class_type: 'FluxGuidance',
      inputs: {
        // FluxGuidance requires conditioning input from CLIPTextEncodeFlux output
        conditioning: ['5', 0],
        guidance: params.cfg,
      },
    },
    '7': {
      _meta: {
        title: 'Empty SD3 Latent Image',
      },
      class_type: 'EmptySD3LatentImage',
      inputs: {
        batch_size: WORKFLOW_DEFAULTS.IMAGE.BATCH_SIZE,
        height: params.height,
        width: params.width,
      },
    },
    '8': {
      _meta: {
        title: 'K Sampler Select',
      },
      class_type: 'KSamplerSelect',
      inputs: {
        sampler_name: params.samplerName,
      },
    },
    '9': {
      _meta: {
        title: 'Basic Scheduler',
      },
      class_type: 'BasicScheduler',
      inputs: {
        denoise: WORKFLOW_DEFAULTS.SAMPLING.DENOISE,
        model: ['4', 0],
        scheduler: params.scheduler,
        steps: params.steps,
      },
    },
  };

  /* eslint-enable sort-keys-fix/sort-keys-fix */

  workflow['5'].inputs.clip_l = clipLPrompt;
  workflow['5'].inputs.t5xxl = t5xxlPrompt;

  // Set shared values directly to avoid conflicts - use params directly without intermediate variables
  workflow['4'].inputs.width = params.width; // ModelSamplingFlux needs width/height
  workflow['4'].inputs.height = params.height;
  workflow['5'].inputs.guidance = params.cfg; // CLIPTextEncodeFlux needs guidance
  workflow['7'].inputs.width = params.width; // EmptySD3LatentImage needs width/height
  workflow['7'].inputs.height = params.height;
  workflow['6'].inputs.guidance = params.cfg; // FluxGuidance needs guidance
  workflow['8'].inputs.sampler_name = params.samplerName; // KSamplerSelect needs sampler_name
  workflow['9'].inputs.steps = params.steps; // BasicScheduler needs steps
  workflow['9'].inputs.scheduler = params.scheduler; // BasicScheduler needs scheduler
  workflow['13'].inputs.noise_seed = params.seed ?? generateUniqueSeeds(1)[0]; // RandomNoise needs seed

  // Create PromptBuilder
  const builder = new PromptBuilder(
    workflow,
    ['width', 'height', 'steps', 'cfg', 'seed', 'samplerName', 'scheduler'],
    ['images'],
  );

  // Set output node
  builder.setOutputNode('images', '12');

  // Set input node mappings
  builder.setInputNode('seed', '13.inputs.noise_seed');
  builder.setInputNode('width', '7.inputs.width');
  builder.setInputNode('height', '7.inputs.height');
  builder.setInputNode('steps', '9.inputs.steps');
  builder.setInputNode('cfg', '6.inputs.guidance');
  builder.setInputNode('samplerName', '8.inputs.sampler_name');
  builder.setInputNode('scheduler', '9.inputs.scheduler');

  // Set input values (prompt already set directly in workflow)
  builder
    .input('width', params.width)
    .input('height', params.height)
    .input('steps', params.steps)
    .input('cfg', params.cfg)
    .input('seed', params.seed ?? generateUniqueSeeds(1)[0])
    .input('samplerName', params.samplerName)
    .input('scheduler', params.scheduler);

  return builder;
}
