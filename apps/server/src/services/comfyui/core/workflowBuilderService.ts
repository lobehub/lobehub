/**
 * Workflow Builder Service
 *
 * Coordinator service for routing workflow requests to specific implementations
 * Maintains clean separation between coordination and business logic
 */
import { type PromptBuilder } from '@saintno/comfyui-sdk';
import debug from 'debug';

import { getWorkflowBuilder } from '@/server/services/comfyui/config/workflowRegistry';
import { type ComfyUIClientService } from '@/server/services/comfyui/core/comfyUIClientService';
import { type ModelResolverService } from '@/server/services/comfyui/core/modelResolverService';
import { WorkflowError } from '@/server/services/comfyui/errors';
import { type WorkflowDetectionResult } from '@/server/services/comfyui/utils/workflowDetector';

const log = debug('lobe-image:comfyui:workflow-builder');

/**
 * Workflow context for builders
 */
export interface WorkflowContext {
  clientService: ComfyUIClientService;
  modelResolverService: ModelResolverService;
  variant?: string;
}

/**
 * Workflow Builder Service - Coordinator Only
 * Routes workflow requests to appropriate implementations
 */
export class WorkflowBuilderService {
  private context: WorkflowContext;

  constructor(context: WorkflowContext) {
    this.context = context;
  }

  /**
   * Build workflow based on model detection result
   * Uses the configuration-driven workflow builder lookup
   */
  async buildWorkflow(
    modelId: string,
    detectionResult: WorkflowDetectionResult,
    modelFileName: string,
    params: Record<string, any>,
  ): Promise<PromptBuilder<any, any, any>> {
    log('Building workflow for:', modelId, 'architecture:', detectionResult.architecture);

    const { isSupported, architecture, variant } = detectionResult;

    if (!isSupported) {
      throw new WorkflowError(
        WorkflowError.Reasons.UNSUPPORTED_MODEL,
        `Unsupported model architecture: ${architecture}`,
        { architecture, modelId, variant },
      );
    }

    // Get workflow builder from configuration
    const workflowBuilder = getWorkflowBuilder(architecture, variant);

    if (!workflowBuilder) {
      throw new WorkflowError(
        WorkflowError.Reasons.UNSUPPORTED_MODEL,
        `No workflow builder found for architecture: ${architecture}, variant: ${variant}`,
        { architecture, modelId, variant },
      );
    }

    // Create context with variant for this specific workflow build
    const contextWithVariant: WorkflowContext = {
      ...this.context,
      variant,
    };

    return workflowBuilder(modelFileName, params, contextWithVariant);
  }
}
