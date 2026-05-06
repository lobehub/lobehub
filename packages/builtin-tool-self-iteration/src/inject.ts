import type { LobeToolManifest, OperationToolSet, ToolSource } from '@lobechat/context-engine';

import { selfIterationIntentManifest } from './manifest';
import type { ShouldExposeSelfIterationIntentToolOptions } from './types';
import { SELF_ITERATION_INTENT_IDENTIFIER, SELF_ITERATION_INTENT_TOOL_NAME } from './types';

/** Mutable operation tool-set parts that can receive the injected builtin tool. */
export interface SelfIterationIntentToolSetParts {
  /** Enabled tool identifiers persisted with the operation. */
  enabledToolIds: string[];
  /** Manifest map persisted with the operation. */
  manifestMap: Record<string, LobeToolManifest>;
  /** Source map persisted with the operation. */
  sourceMap: Record<string, ToolSource>;
  /** LLM-visible function tools for the operation. */
  tools: OperationToolSet['tools'];
}

const createSelfIterationIntentTool = () =>
  selfIterationIntentManifest.api.map((api) => ({
    function: {
      description: api.description,
      name: SELF_ITERATION_INTENT_TOOL_NAME,
      parameters: api.parameters,
    },
    type: 'function' as const,
  }));

/**
 * Decides whether the self-iteration intent declaration tool should be visible.
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
export const shouldExposeSelfIterationIntentTool = (
  options: ShouldExposeSelfIterationIntentToolOptions,
) => {
  if (!options.featureUserEnabled || !options.agentSelfIterationEnabled) return false;
  if (options.disabled || options.disableSelfIterationIntentTool || options.reviewerRole) {
    return false;
  }

  return true;
};

/**
 * Injects the self-iteration intent manifest and LLM tool into a tool set.
 *
 * Use when:
 * - `execAgent` has already built the normal model/tool path
 * - The operation should expose advisory self-iteration intent as a builtin server tool
 *
 * Expects:
 * - Caller has already checked visibility gates
 *
 * Returns:
 * - `true` when this call added the tool, otherwise `false` when it was already present
 */
export const injectSelfIterationIntentTool = (toolSetParts: SelfIterationIntentToolSetParts) => {
  const wasAlreadyEnabled = toolSetParts.enabledToolIds.includes(SELF_ITERATION_INTENT_IDENTIFIER);
  const wasAlreadyVisible = toolSetParts.tools.some(
    (tool) => tool.function.name === SELF_ITERATION_INTENT_TOOL_NAME,
  );

  toolSetParts.manifestMap[SELF_ITERATION_INTENT_IDENTIFIER] = selfIterationIntentManifest;
  toolSetParts.sourceMap[SELF_ITERATION_INTENT_IDENTIFIER] = 'builtin';

  if (!wasAlreadyEnabled) {
    toolSetParts.enabledToolIds.push(SELF_ITERATION_INTENT_IDENTIFIER);
  }

  if (!wasAlreadyVisible) {
    toolSetParts.tools.push(...createSelfIterationIntentTool());
  }

  return !wasAlreadyEnabled || !wasAlreadyVisible;
};
