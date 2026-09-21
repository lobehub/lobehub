import { MessagesEngine } from '@lobechat/context-engine';
import type { OpenAIChatMessage } from '@lobechat/types';

import { buildMessagesEngineParams } from './buildMessagesEngineParams';
import type { ContextSnapshot } from './types';

/**
 * Run the context engine over a snapshot and return the messages to send.
 * The host owns gathering the snapshot and anything it does with the result.
 */
export const runContextEngineering = async (
  snapshot: ContextSnapshot,
): Promise<OpenAIChatMessage[]> => {
  const engine = new MessagesEngine(buildMessagesEngineParams(snapshot));
  const result = await engine.process();
  return result.messages;
};

export { buildMessagesEngineParams } from './buildMessagesEngineParams';
export * from './facts';
export type * from './types';
export {
  createVariableGenerators,
  type CreateVariableGeneratorsParams,
} from './variableGenerators';
