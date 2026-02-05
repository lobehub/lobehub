/**
 * SD3.5 Workflow with Static JSON Structure
 *
 * Supports three encoder configurations through conditional values:
 * 1. Triple: CLIP L + CLIP G + T5 (best quality)
 * 2. Dual CLIP: CLIP L + CLIP G only
 * 3. T5 only: T5XXL encoder only
 */
import { generateUniqueSeeds } from '@lobechat/utils';
import { PromptBuilder } from '@saintno/comfyui-sdk';

import {
  DEFAULT_NEGATIVE_PROMPT,
  WORKFLOW_DEFAULTS,
} from '@/server/services/comfyui/config/constants';
import type { WorkflowContext } from '@/server/services/comfyui/core/workflowBuilderService';
import { WorkflowError } from '@/server/services/comfyui/errors';
import { getWorkflowFilenamePrefix } from '@/server/services/comfyui/utils/workflowUtils';

/**
 * Detect available encoder configuration using service layer
 */
async function detectAvailableEncoder(context: WorkflowContext): Promise<{
  clipG?: string;
  clipL?: string;
  t5?: string;
  type: 'triple' | 'dual_clip' | 't5';
} | null> {
  // Get components from service
  const clipL = await context.modelResolverService.getOptimalComponent('clip', 'FLUX');
  const clipG = await context.modelResolverService.getOptimalComponent('clip', 'SD3');
  const t5 = await context.modelResolverService.getOptimalComponent('t5', 'FLUX');

  // Best case: all three encoders
  if (clipL && clipG && t5) {
    return {
      clipG,
      clipL,
      t5,
      type: 'triple',
    };
  }

  // Dual CLIP configuration
  if (clipL && clipG) {
    return {
      clipG,
      clipL,
      type: 'dual_clip',
    };
  }

  // T5 only configuration
  if (t5) {
    return {
      t5,
      type: 't5',
    };
  }

  return null;
}

/**
 * Build SD3.5 workflow with static JSON structure
 */
export async function buildSD35Workflow(
  modelFileName: string,
  params: Record<string, any>,
  context: WorkflowContext,
): Promise<PromptBuilder<any, any, any>> {
  // Detect available encoders using service layer
  const encoderConfig = await detectAvailableEncoder(context);

  // SD3.5 REQUIRES external encoders - no encoder = throw error
  if (!encoderConfig) {
    throw new WorkflowError(
      'SD3.5 models require external CLIP/T5 encoder files. Available configurations: 1) Triple (CLIP L+G+T5), 2) Dual CLIP (L+G), or 3) T5 only. No encoder files found.',
      WorkflowError.Reasons.MISSING_ENCODER,
      { model: modelFileName },
    );
  }

  // Configure conditioning references based on encoder type
  const clipNode = ['2', 0];
  const positiveConditioningNode: [string, number] = ['3', 0];
  const negativeConditioningNode: [string, number] = ['4', 0];

  // Build complete static JSON structure with conditional values
  /* eslint-disable sort-keys-fix/sort-keys-fix */
  const workflow = {
    '1': {
      _meta: { title: 'Load Checkpoint' },
      class_type: 'CheckpointLoaderSimple',
      inputs: {
        ckpt_name: modelFileName,
      },
    },
    '2':
      encoderConfig.type === 'triple'
        ? {
            _meta: { title: 'Triple CLIP Loader' },
            class_type: 'TripleCLIPLoader',
            inputs: {
              clip_name1: encoderConfig.clipL,
              clip_name2: encoderConfig.clipG,
              clip_name3: encoderConfig.t5,
            },
          }
        : encoderConfig.type === 'dual_clip'
          ? {
              _meta: { title: 'Dual CLIP Loader' },
              class_type: 'DualCLIPLoader',
              inputs: {
                clip_name1: encoderConfig.clipL,
                clip_name2: encoderConfig.clipG,
              },
            }
          : {
              _meta: { title: 'Load T5' },
              class_type: 'CLIPLoader',
              inputs: {
                clip_name: encoderConfig.t5,
                type: 't5',
              },
            },
    '3': {
      _meta: { title: 'Positive Prompt' },
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: clipNode,
        text: params.prompt,
      },
    },
    '4': {
      _meta: { title: 'Negative Prompt' },
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: clipNode,
        text: DEFAULT_NEGATIVE_PROMPT,
      },
    },
    '5': {
      _meta: { title: 'Empty SD3 Latent Image' },
      class_type: 'EmptySD3LatentImage',
      inputs: {
        batch_size: WORKFLOW_DEFAULTS.IMAGE.BATCH_SIZE,
        height: params.height,
        width: params.width,
      },
    },
    '6': {
      _meta: { title: 'KSampler' },
      class_type: 'KSampler',
      inputs: {
        cfg: params.cfg,
        denoise: WORKFLOW_DEFAULTS.SAMPLING.DENOISE,
        latent_image: ['5', 0],
        model: ['12', 0], // Use ModelSamplingSD3 output
        negative: negativeConditioningNode,
        positive: positiveConditioningNode,
        sampler_name: params.samplerName,
        scheduler: params.scheduler,
        seed: params.seed ?? generateUniqueSeeds(1)[0],
        steps: params.steps,
      },
    },
    '7': {
      _meta: { title: 'VAE Decode' },
      class_type: 'VAEDecode',
      inputs: {
        samples: ['6', 0],
        vae: ['1', 2],
      },
    },
    '8': {
      _meta: { title: 'Save Image' },
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: getWorkflowFilenamePrefix('buildSD35Workflow', context.variant),
        images: ['7', 0],
      },
    },
    '12': {
      _meta: { title: 'ModelSamplingSD3' },
      class_type: 'ModelSamplingSD3',
      inputs: {
        model: ['1', 0],
        shift: WORKFLOW_DEFAULTS.SD3.SHIFT,
      },
    },
  };
  /* eslint-enable sort-keys-fix/sort-keys-fix */

  // Create PromptBuilder
  const builder = new PromptBuilder(
    workflow,
    ['prompt', 'width', 'height', 'steps', 'seed', 'cfg', 'samplerName', 'scheduler'],
    ['images'],
  );

  // Set output node
  builder.setOutputNode('images', '8');

  // Set input node mappings
  builder.setInputNode('prompt', '3.inputs.text');
  builder.setInputNode('width', '5.inputs.width');
  builder.setInputNode('height', '5.inputs.height');
  builder.setInputNode('steps', '6.inputs.steps');
  builder.setInputNode('seed', '6.inputs.seed');
  builder.setInputNode('cfg', '6.inputs.cfg');
  builder.setInputNode('samplerName', '6.inputs.sampler_name');
  builder.setInputNode('scheduler', '6.inputs.scheduler');

  // Set input values
  builder
    .input('prompt', params.prompt)
    .input('width', params.width)
    .input('height', params.height)
    .input('steps', params.steps)
    .input('cfg', params.cfg)
    .input('seed', params.seed ?? generateUniqueSeeds(1)[0])
    .input('samplerName', params.samplerName)
    .input('scheduler', params.scheduler);

  return builder;
}
