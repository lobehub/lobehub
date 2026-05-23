import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { log } from '../utils/logger';

export function registerNotifyCommand(program: Command) {
  program
    .command('notify')
    .description('Send a callback message to a topic and trigger the agent to process it')
    .requiredOption('--topic <topicId>', 'Target topic ID')
    .requiredOption('-c, --content <content>', 'Message content')
    .option('--agent-id <agentId>', 'Agent ID (overrides topic default)')
    .option('--thread-id <threadId>', 'Thread ID for threaded conversations')
    .option(
      '--role <role>',
      'Message role: user (default, triggers agent reply) | assistant (writes directly as agent message)',
      'user',
    )
    .option(
      '--message-id <messageId>',
      'When --role assistant: update an existing message instead of creating a new one (keeps a single bubble)',
    )
    .option(
      '--continue',
      'When --role assistant: trigger a follow-up agent turn after writing the message',
    )
    .option('--json', 'Output JSON')
    .action(
      async (options: {
        agentId?: string;
        content: string;
        continue?: boolean;
        json?: boolean;
        messageId?: string;
        role?: 'assistant' | 'user';
        threadId?: string;
        topic: string;
      }) => {
        log.debug(
          'notify: topic=%s, agentId=%s, role=%s, messageId=%s',
          options.topic,
          options.agentId,
          options.role,
          options.messageId,
        );

        const client = await getTrpcClient();

        try {
          const result = await client.agentNotify.notify.mutate({
            agentId: options.agentId,
            content: options.content,
            continue: options.continue,
            messageId: options.messageId,
            role: options.role,
            threadId: options.threadId,
            topicId: options.topic,
          });

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }

          console.log(`${pc.green('✓')} Message sent to topic ${pc.bold(result.topicId)}`);
          if (result.operationId) {
            console.log(`  Operation ID: ${result.operationId}`);
          }
        } catch (error: any) {
          console.error(`${pc.red('✗')} Failed to send notification: ${error.message}`);
          process.exit(1);
        }
      },
    );
}
