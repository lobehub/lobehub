import type { Command } from 'commander';

import { getTrpcClient } from '../api/client';
import { outputJson, printTable } from '../utils/format';
import { resolveUrlBuilder, resourcePath } from './resourceUrl';

interface LinkedTopic {
  agentId: string | null;
  groupId: string | null;
  title: string | null;
  topicId: string;
}

export function registerWorkCommand(program: Command) {
  const work = program.command('work').description('Look up agent work');

  work
    .command('lookup')
    .argument('<github-pr-url>', 'GitHub pull request URL')
    .description('Find all conversations linked to a GitHub pull request in the current workspace')
    .option('--json', 'Output JSON')
    .action(async (url: string, options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const { data }: { data: LinkedTopic[] } = await client.work.lookupPullRequest.query({ url });

      if (data.length === 0) {
        if (options.json) outputJson([]);
        else console.log('No linked conversations found in the current workspace.');
        return;
      }

      const toUrl = await resolveUrlBuilder(client);
      const topics = data.map((topic) => ({
        ...topic,
        url: toUrl(resourcePath.topic({ ...topic, id: topic.topicId })),
      }));

      if (options.json) outputJson(topics);
      else {
        printTable(
          topics.map((topic) => [topic.title || 'Untitled', topic.url || topic.topicId]),
          ['TITLE', 'CONVERSATION'],
        );
      }
    });
}
