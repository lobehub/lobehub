import type { LobeToolManifest, OperationToolSet, ToolSource } from '@lobechat/context-engine';

import { selfFeedbackIntentManifest } from './manifest';
import type { ShouldExposeSelfFeedbackIntentToolOptions } from './types';
import { SELF_FEEDBACK_INTENT_IDENTIFIER, SELF_FEEDBACK_INTENT_TOOL_NAME } from './types';

/** Mutable operation tool-set parts that can receive the injected builtin tool. */
export interface SelfFeedbackIntentToolSetParts {
  /** Enabled tool identifiers persisted with the operation. */
  enabledToolIds: string[];
  /** Manifest map persisted with the operation. */
  manifestMap: Record<string, LobeToolManifest>;
  /** Source map persisted with the operation. */
  sourceMap: Record<string, ToolSource>;
  /** LLM-visible function tools for the operation. */
  tools: OperationToolSet['tools'];
}

const createSelfFeedbackIntentTool = () =>
  selfFeedbackIntentManifest.api.map((api) => ({
    function: {
      description: api.description,
      name: SELF_FEEDBACK_INTENT_TOOL_NAME,
      parameters: api.parameters,
    },
    type: 'function' as const,
  }));

/**
 * Decides whether the self-feedback intent declaration tool should be visible.
 *
 * Use when:
 * - Tests need a pure visibility predicate
 * - Runtime injection needs to combine feature, agent, and caller gates
 *
 * Expects:
 * - `featureUserEnabled` already includes server/user Labs eligibility
 *
 * Returns:
 * - `true` only for ordinary running agents with all gates enabled
 */
export const shouldExposeSelfFeedbackIntentTool = (
  options: ShouldExposeSelfFeedbackIntentToolOptions,
) => {
  if (!options.featureUserEnabled || !options.agentSelfIterationEnabled) return false;
  if (options.disabled || options.disableSelfFeedbackIntentTool || options.reviewerRole) {
    return false;
  }

  return true;
};

/**
 * Injects the self-feedback intent manifest and LLM tool into a tool set.
 *
 * Use when:
 * - `execAgent` has already built the normal model/tool path
 * - The operation should expose advisory self-feedback intent as a builtin server tool
 *
 * Expects:
 * - Caller has already checked visibility gates
 *
 * Returns:
 * - `true` when this call added the tool, otherwise `false` when it was already present
 */
export const injectSelfFeedbackIntentTool = (toolSetParts: SelfFeedbackIntentToolSetParts) => {
  const wasAlreadyEnabled = toolSetParts.enabledToolIds.includes(SELF_FEEDBACK_INTENT_IDENTIFIER);
  const wasAlreadyVisible = toolSetParts.tools.some(
    (tool) => tool.function.name === SELF_FEEDBACK_INTENT_TOOL_NAME,
  );

  toolSetParts.manifestMap[SELF_FEEDBACK_INTENT_IDENTIFIER] = selfFeedbackIntentManifest;
  toolSetParts.sourceMap[SELF_FEEDBACK_INTENT_IDENTIFIER] = 'builtin';

  if (!wasAlreadyEnabled) {
    toolSetParts.enabledToolIds.push(SELF_FEEDBACK_INTENT_IDENTIFIER);
  }

  if (!wasAlreadyVisible) {
    toolSetParts.tools.push(...createSelfFeedbackIntentTool());
  }

  return !wasAlreadyEnabled || !wasAlreadyVisible;
};
