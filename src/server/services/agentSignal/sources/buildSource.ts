import type { AgentSignalSource } from '@lobechat/agent-signal';

import { agentExecutionCompletedRenderer } from './renderers/agentExecutionCompleted';
import { agentExecutionFailedRenderer } from './renderers/agentExecutionFailed';
import { agentUserMessageRenderer } from './renderers/agentUserMessage';
import { defaultSourceRenderer } from './renderers/defaultSource';
import { runtimeAfterStepRenderer } from './renderers/runtimeAfterStep';
import { runtimeBeforeStepRenderer } from './renderers/runtimeBeforeStep';
import type { EmitSourceEventInput, SourceRenderer } from './types';

const sourceRenderers = new Map<AgentSignalSource['sourceType'], SourceRenderer>([
  [agentExecutionCompletedRenderer.sourceType, agentExecutionCompletedRenderer],
  [agentExecutionFailedRenderer.sourceType, agentExecutionFailedRenderer],
  [agentUserMessageRenderer.sourceType, agentUserMessageRenderer],
  [runtimeAfterStepRenderer.sourceType, runtimeAfterStepRenderer],
  [runtimeBeforeStepRenderer.sourceType, runtimeBeforeStepRenderer],
]);

/**
 * Builds one normalized Agent Signal source from producer input.
 *
 * Use when:
 * - Server producers hand over loosely-shaped payloads
 * - The runtime needs one stable source envelope before dedupe/window handling
 *
 * Expects:
 * - `input.sourceType` selects the matching renderer when one exists
 *
 * Returns:
 * - A normalized {@link AgentSignalSource}
 */
export const buildSource = (input: EmitSourceEventInput): AgentSignalSource => {
  const renderer = sourceRenderers.get(input.sourceType) ?? defaultSourceRenderer;

  return renderer.render(input);
};
