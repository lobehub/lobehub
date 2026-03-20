import type { CommandType } from '@/features/ChatInput/InputEditor/ActionTag/types';

import type { SendMessageWithContextParams } from '../conversationLifecycle';
import { compactHandler, newTopicHandler } from './handlers';
import { parseCommandsFromEditorData } from './parseCommands';
import type { CommandHandlerContext, CommandRegistry, CommandSendOverrides } from './types';

export { injectReferTopicNode } from './editorDataHelpers';
export {
  hasNonActionContent,
  parseCommandsFromEditorData,
  parseMentionedAgentsFromEditorData,
  parseSelectedSkillsFromEditorData,
  parseSelectedToolsFromEditorData,
} from './parseCommands';
export type { CommandSendOverrides } from './types';

const COMMAND_REGISTRY: CommandRegistry = {
  compact: compactHandler,
  newTopic: newTopicHandler,
};

/**
 * Process all command tags found in editorData.
 * Returns merged overrides from all matched command handlers.
 */
export const processCommands = (params: SendMessageWithContextParams): CommandSendOverrides => {
  const commands = parseCommandsFromEditorData(params.editorData);
  const commandTags = commands.filter((c) => c.category === 'command');

  if (commandTags.length === 0) return {};

  const ctx: CommandHandlerContext = { params };
  let merged: CommandSendOverrides = {};

  for (const tag of commandTags) {
    const handler = COMMAND_REGISTRY[tag.type as CommandType];
    if (handler) {
      const overrides = handler(ctx);
      if (overrides) {
        merged = { ...merged, ...overrides };
      }
    }
  }

  return merged;
};
