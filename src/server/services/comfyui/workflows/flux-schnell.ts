import { generateUniqueSeeds } from '@lobechat/utils';
import { PromptBuilder } from '@saintno/comfyui-sdk';

import { WORKFLOW_DEFAULTS } from '@/server/services/comfyui/config/constants';
import type { WorkflowContext } from '@/server/services/comfyui/core/workflowBuilderService';
import { splitPromptForDualCLIP } from '@/server/services/comfyui/utils/promptSplitter';
import { selectOptimalWeightDtype } from '@/server/services/comfyui/utils/weightDType';
import { getWorkflowFilenamePrefix } from '@/server/services/comfyui/utils/workflowUtils';

/**
 * FLUX Schnell Workflow Builder
 *
 * @description Builds 4-step fast generation workflow optimized for speed
 *
 * @param {string} modelFileName - Model filename
 * @param {Record<string, any>} params - Generation parameters
 * @param {WorkflowContext} context - Workflow context
 * @returns {PromptBuilder<any, any, any>} Built workflow
 */
export async function buildFluxSchnellWorkflow(
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
        title: 'CLIP Text Encode (Flux)',
      },
      class_type: 'CLIPTextEncodeFlux',
      inputs: {
        clip: ['1', 0],
        clip_l: clipLPrompt,
        guidance: 1,
        t5xxl: t5xxlPrompt, // Schnell uses CFG 1
      },
    },
    '5': {
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
    '6': {
      _meta: {
        title: 'K Sampler',
      },
      class_type: 'KSampler',
      inputs: {
        cfg: 1,
        denoise: WORKFLOW_DEFAULTS.SAMPLING.DENOISE,
        latent_image: ['5', 0],
        model: ['2', 0],
        negative: ['4', 0],
        positive: ['4', 0],
        sampler_name: params.samplerName,
        scheduler: params.scheduler,
        seed: params.seed ?? generateUniqueSeeds(1)[0],
        steps: params.steps,
      },
    },
    '7': {
      _meta: {
        title: 'VAE Decode',
      },
      class_type: 'VAEDecode',
      inputs: {
        samples: ['6', 0],
        vae: ['3', 0],
      },
    },
    '8': {
      _meta: {
        title: 'Save Image',
      },
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: getWorkflowFilenamePrefix('buildFluxSchnellWorkflow', context.variant),
        images: ['7', 0],
      },
    },
  };
  /* eslint-enable sort-keys-fix/sort-keys-fix */

  // Set prompt values directly to workflow nodes instead of using PromptBuilder input mapping
  workflow['4'].inputs.clip_l = clipLPrompt;
  workflow['4'].inputs.t5xxl = t5xxlPrompt;

  // Set shared values directly to avoid conflicts - use params directly without intermediate variables
  workflow['5'].inputs.width = params.width; // EmptySD3LatentImage needs width/height
  workflow['5'].inputs.height = params.height;
  workflow['4'].inputs.guidance = params.cfg; // CLIPTextEncodeFlux needs guidance
  workflow['6'].inputs.cfg = params.cfg; // KSampler needs cfg
  workflow['6'].inputs.steps = params.steps; // KSampler needs steps
  workflow['6'].inputs.seed = params.seed ?? generateUniqueSeeds(1)[0]; // KSampler needs seed
  workflow['6'].inputs.scheduler = params.scheduler; // KSampler needs scheduler
  workflow['6'].inputs.sampler_name = params.samplerName; // KSampler needs sampler_name

  // Create PromptBuilder - removed prompt input parameters as they are set directly
  const builder = new PromptBuilder(
    workflow,
    ['width', 'height', 'steps', 'cfg', 'seed', 'scheduler', 'sampler_name'],
    ['images'],
  );

  // Set output node
  builder.setOutputNode('images', '8');

  // Set input node mappings
  builder.setInputNode('seed', '6.inputs.seed');
  builder.setInputNode('width', '5.inputs.width');
  builder.setInputNode('height', '5.inputs.height');
  builder.setInputNode('steps', '6.inputs.steps');
  builder.setInputNode('cfg', '6.inputs.cfg');

  // Set input values (prompt already set directly in workflow)
  builder
    .input('width', params.width)
    .input('height', params.height)
    .input('steps', params.steps)
    .input('cfg', params.cfg)
    .input('seed', params.seed ?? generateUniqueSeeds(1)[0]);

  return builder;
}
