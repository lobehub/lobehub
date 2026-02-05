/**
 * Workflow utility functions
 * Extracted from workflowRegistry to avoid circular dependencies
 */
import { FLUX_MODEL_CONFIG, SD_MODEL_CONFIG } from '@/server/services/comfyui/config/constants';

/**
 * Workflow function to default filename type mapping
 */
/* eslint-disable sort-keys-fix/sort-keys-fix */
export const WORKFLOW_DEFAULT_TYPE: Record<string, string> = {
  buildFluxDevWorkflow: 'DEV',
  buildFluxSchnellWorkflow: 'SCHNELL',
  buildFluxKontextWorkflow: 'KONTEXT',
  buildSD35Workflow: 'SD35',
  buildSimpleSDWorkflow: 'SD15',
} as const;

/**
 * Variant override rules
 */
export const VARIANT_TYPE_OVERRIDE: Record<string, string> = {
  // FLUX special variants
  'krea': 'KREA', // Override buildFluxDevWorkflow default output

  // SD special variants
  'sd35': 'SD35',
  'sd35-inclclip': 'SD35',
  'sdxl-t2i': 'SDXL',
  'sdxl-i2i': 'SDXL',
  'custom-sd': 'CUSTOM',

  // Model families
  'FLUX': 'DEV',
  'SD3': 'SD35',
  'SD1': 'SD15',
  'SDXL': 'SDXL',
} as const;
/* eslint-enable sort-keys-fix/sort-keys-fix */

/**
 * Get the filename prefix for ComfyUI workflow output files
 *
 * @param workflowName - The workflow builder function name
 * @param variant - Optional variant to override default type
 * @returns Filename prefix with date placeholders
 */
export function getWorkflowFilenamePrefix(workflowName: string, variant?: string): string {
  // 1. Prioritize variant override
  const type =
    variant && VARIANT_TYPE_OVERRIDE[variant]
      ? VARIANT_TYPE_OVERRIDE[variant]
      : WORKFLOW_DEFAULT_TYPE[workflowName];

  if (!type) {
    return 'LobeChat/%year%-%month%-%day%/Unknown';
  }

  // 2. Get filename prefix based on type
  if (type in FLUX_MODEL_CONFIG.FILENAME_PREFIXES) {
    return FLUX_MODEL_CONFIG.FILENAME_PREFIXES[
      type as keyof typeof FLUX_MODEL_CONFIG.FILENAME_PREFIXES
    ];
  }

  if (type in SD_MODEL_CONFIG.FILENAME_PREFIXES) {
    return SD_MODEL_CONFIG.FILENAME_PREFIXES[
      type as keyof typeof SD_MODEL_CONFIG.FILENAME_PREFIXES
    ];
  }

  return 'LobeChat/%year%-%month%-%day%/Unknown';
}
