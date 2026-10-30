import type { Command } from 'commander';

import { getTrpcClient } from '../../api/client';
import { resolveWorkspaceRef } from '../../api/workspaceRef';
import { reportConversationSend, sendToConversation } from '../topic/send';

export function registerMessageReplyCommand(message: Command) {
  message
    .command('reply <messageId>')
    .description(
      'Answer a message another agent sent you: the reply goes to the conversation it came from and wakes its agent',
    )
    .requiredOption('-c, --content <content>', 'Reply content')
    .option(
      '--workspace <id|slug>',
      "The workspace the message lives in (overrides LOBEHUB_WORKSPACE_ID and 'workspace use')",
    )
    .option('--json', 'Output JSON')
    .action(
      async (
        messageId: string,
        options: { content: string; json?: boolean; workspace?: string },
      ) => {
        const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));

        await reportConversationSend(async () => {
          const origin = await client.message.getMessageOrigin.query({ id: messageId });
          if (!origin) throw new Error(`Message ${messageId} not found in this workspace.`);

          const sender = origin.agentSender;
          if (!sender) {
            throw new Error(
              `Message ${messageId} was not sent by an agent, so there is no conversation to reply to. To write to a conversation, use 'lh topic send <topicId>'.`,
            );
          }
          if (!sender.topicId) {
            throw new Error(
              `The conversation message ${messageId} came from cannot be reached from here; tell the user instead.`,
            );
          }

          return sendToConversation(client, {
            content: options.content,
            threadId: sender.threadId,
            topicId: sender.topicId,
          });
        }, options);
      },
    );
}
