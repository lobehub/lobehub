import type { PipelineContextMetadata } from '@lobechat/context-engine';
import { MessagesEngine } from '@lobechat/context-engine';
import type { OpenAIChatMessage } from '@lobechat/types';

import { buildMessagesEngineParams } from './buildMessagesEngineParams';
import type { ContextSnapshot } from './types';

export interface ContextEngineeringResult {
  messages: OpenAIChatMessage[];
  /**
   * Pipeline metadata emitted by processors (trim stats, truncation counts,
   * cache-relevant decisions). Carried through so hosts can record it —
   * e.g. into operation trace steps — instead of dropping it at the boundary.
   */
  metadata: PipelineContextMetadata;
}

/**
 * Run the context engine over a snapshot and return the messages to send.
 * The host owns gathering the snapshot and anything it does with the result.
 */
export const runContextEngineering = async (
  snapshot: ContextSnapshot,
): Promise<ContextEngineeringResult> => {
  const engine = new MessagesEngine(buildMessagesEngineParams(snapshot));
  const result = await engine.process();
  return { messages: result.messages, metadata: result.metadata };
};

export { buildMessagesEngineParams } from './buildMessagesEngineParams';
export * from './facts';
export type * from './types';
export {
  createVariableGenerators,
  type CreateVariableGeneratorsParams,
} from './variableGenerators';
