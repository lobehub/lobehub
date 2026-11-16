import type { Command } from 'commander';

import { getTrpcClient } from '../api/client';
import { isOperationToken } from '../api/operationTokenFallback';
import { outputJson } from '../utils/format';

/** Cloud Git operations use the requester's server binding, never the device owner's identity. */
export function registerTfsCommand(program: Command) {
  program
    .command('tfs')
    .description('TFS / Azure DevOps Server operations')
    .command('git <operation>')
    .description(
      'Fetch, fast-forward pull or push the selected TFS source in the conversation cloud working directory',
    )
    .option('--topic <id>', 'Conversation ID; defaults to LOBEHUB_TOPIC_ID')
    .option('--source <index>', 'Git source index from tfs_repositories', '0')
    .option('--branch <name>', 'Target branch; defaults to the selected source branch')
    .action(
      async (operation: string, options: { branch?: string; source: string; topic?: string }) => {
        if (operation !== 'fetch' && operation !== 'pull' && operation !== 'push')
          throw new Error('TFS Git operation must be fetch, pull or push.');
        if (!/^\d{1,2}$/.test(options.source)) throw new Error('Invalid Git source index.');
        const input = { operation, branch: options.branch, sourceIndex: Number(options.source) };
        const client = await getTrpcClient();
        let result;
        if (isOperationToken(process.env.LOBEHUB_JWT)) {
          if (options.topic && options.topic !== process.env.LOBEHUB_TOPIC_ID)
            throw new Error('An operation can only access its own conversation.');
          result = await client.tfs.gitOperation.mutate(input);
        } else {
          const topicId = options.topic ?? process.env.LOBEHUB_TOPIC_ID;
          if (!topicId) throw new Error('Specify --topic for the cloud working directory.');
          result = await client.tfs.git.mutate({ ...input, topicId });
        }
        outputJson(result);
        if (!result.success) process.exitCode = 1;
      },
    );
}
