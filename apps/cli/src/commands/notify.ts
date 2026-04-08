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
    .option('--session-id <sessionId>', 'External session ID for tracing')
    .option('--json', 'Output JSON')
    .action(
      async (options: { content: string; json?: boolean; sessionId?: string; topic: string }) => {
        log.debug('notify: topic=%s, sessionId=%s', options.topic, options.sessionId);

        const client = await getTrpcClient();

        try {
          const result = await client.agentNotify.notify.mutate({
            content: options.content,
            sessionId: options.sessionId,
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
