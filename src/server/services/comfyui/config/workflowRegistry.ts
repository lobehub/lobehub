import type { PromptBuilder } from '@saintno/comfyui-sdk';

import type { WorkflowContext } from '@/server/services/comfyui/core/workflowBuilderService';
// Import all workflow builders
import { buildFluxDevWorkflow } from '@/server/services/comfyui/workflows/flux-dev';
import { buildFluxKontextWorkflow } from '@/server/services/comfyui/workflows/flux-kontext';
import { buildFluxSchnellWorkflow } from '@/server/services/comfyui/workflows/flux-schnell';
import { buildSD35Workflow } from '@/server/services/comfyui/workflows/sd35';
import { buildSimpleSDWorkflow } from '@/server/services/comfyui/workflows/simple-sd';

// Workflow builder type
type WorkflowBuilder = (
  modelFileName: string,
  params: Record<string, any>,
  context: WorkflowContext,
) => Promise<PromptBuilder<any, any, any>>;

/**
 * Variant to Workflow mapping
 * Based on actual model registry variant values
 */
/* eslint-disable sort-keys-fix/sort-keys-fix */
export const VARIANT_WORKFLOW_MAP: Record<string, WorkflowBuilder> = {
  // FLUX variants
  'dev': buildFluxDevWorkflow,
  'schnell': buildFluxSchnellWorkflow,
  'kontext': buildFluxKontextWorkflow,
  'krea': buildFluxDevWorkflow,

  // SD3 variants
  'sd35': buildSD35Workflow, // needs external encoders
  'sd35-inclclip': buildSimpleSDWorkflow, // built-in encoders

  // SD1/SDXL variants
  'sd15-t2i': buildSimpleSDWorkflow,
  'sdxl-t2i': buildSimpleSDWorkflow,
  'sdxl-i2i': buildSimpleSDWorkflow,
  'custom-sd': buildSimpleSDWorkflow,
};

/**
 * Architecture default workflows (when variant not matched)
 */
export const ARCHITECTURE_DEFAULT_MAP: Record<string, WorkflowBuilder> = {
  FLUX: buildFluxDevWorkflow,
  SD3: buildSD35Workflow,
  SD1: buildSimpleSDWorkflow,
  SDXL: buildSimpleSDWorkflow,
};
/* eslint-enable sort-keys-fix/sort-keys-fix */

/**
 * Get the appropriate workflow builder for a given architecture and variant
 *
 * @param architecture - Model architecture (FLUX, SD3, SD1, SDXL)
 * @param variant - Model variant (dev, schnell, kontext, sd35, etc.)
 * @returns Workflow builder function or undefined if not found
 */
export function getWorkflowBuilder(
  architecture: string,
  variant?: string,
): WorkflowBuilder | undefined {
  // Prefer variant mapping
  if (variant && VARIANT_WORKFLOW_MAP[variant]) {
    return VARIANT_WORKFLOW_MAP[variant];
  }

  // Fallback to architecture default
  return ARCHITECTURE_DEFAULT_MAP[architecture];
}
