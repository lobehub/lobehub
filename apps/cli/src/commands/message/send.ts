import type { Command } from 'commander';

import { getTrpcClient } from '../../api/client';
import { resolveWorkspaceId } from '../../api/workspace';
import { resolveWorkspaceRef } from '../../api/workspaceRef';
import {
  NEW_CONVERSATION_OPTIONS_HELP,
  type NewConversationOptions,
  reportConversationSend,
  sendToConversation,
  sendToNewConversation,
} from '../topic/send';

/**
 * `lh message send`: the message-first spelling of `lh topic send`. With
 * `--topic-id` the message goes to that conversation; without it, a new
 * conversation is opened for it.
 */
export function registerMessageSendCommand(message: Command) {
  message
    .command('send')
    .description(
      "Send a message and have an agent act on it: to an existing conversation with --topic-id (queued if it is busy), otherwise to a new one. Unlike 'lh message create', this wakes the agent",
    )
    .requiredOption('-c, --content <content>', 'Message content')
    .option('--topic-id <id>', 'Conversation to send to; omit to open a new conversation')
    .option('--agent-id <id>', `New conversation only: ${NEW_CONVERSATION_OPTIONS_HELP.agentId}`)
    .option('--device <target>', `New conversation only: ${NEW_CONVERSATION_OPTIONS_HELP.device}`)
    .option('--title <title>', `New conversation only: ${NEW_CONVERSATION_OPTIONS_HELP.title}`)
    .option(
      '--workspace <id|slug>',
      "The workspace to send in (overrides LOBEHUB_WORKSPACE_ID and 'workspace use')",
    )
    .option('--json', 'Output JSON')
    .addHelpText(
      'after',
      `
Examples:
  lh message send --topic-id tpc_xxx -c "Iterate the verifier with these notes"
  lh message send -c "Draft the release notes" --device local --title "Release notes"

Same delivery as 'lh topic send': run by an agent, the message is shown as
written by that agent, and the receiver answers with 'lh message reply'.`,
    )
    .action(
      async (
        options: NewConversationOptions & {
          content: string;
          json?: boolean;
          topicId?: string;
          workspace?: string;
        },
      ) => {
        const workspace = await resolveWorkspaceRef(options.workspace);
        const client = await getTrpcClient(workspace);
        await reportConversationSend(() => {
          if (!options.topicId) {
            return sendToNewConversation(client, {
              ...options,
              workspaceId: resolveWorkspaceId(workspace),
            });
          }
          if (options.agentId || options.device || options.title) {
            throw new Error(
              '--agent-id, --device and --title only apply to a new conversation; drop --topic-id to open one.',
            );
          }
          return sendToConversation(client, { content: options.content, topicId: options.topicId });
        }, options);
      },
    );
}
