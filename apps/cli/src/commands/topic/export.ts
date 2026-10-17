import { writeFile } from 'node:fs/promises';

import type { Command } from 'commander';
import { Option } from 'commander';

import { getTrpcClient } from '../../api/client';
import type { TopicTranscript } from './atif';
import { toAtif } from './atif';

export function registerTopicExportCommand(topic: Command) {
  topic
    .command('export <id>')
    .description(
      'Export text-only topic interactions as an ATIF trajectory (single agent, no threads or branches)',
    )
    .addOption(new Option('--format <format>', 'Export format').choices(['atif']).default('atif'))
    .option('-o, --output <path>', 'Write to a file instead of stdout (use - for stdout)')
    .option('--workspace <id>', 'Read the topic from this workspace')
    .action(async (id: string, options: { output?: string; workspace?: string }) => {
      const client = await getTrpcClient(options.workspace);
      let transcript: TopicTranscript | undefined;
      const items: TopicTranscript['items'] = [];
      do {
        const page = await client.topic.getTopicTranscript.query({
          includeMessages: true,
          limit: 500,
          offset: items.length,
          topicId: id,
        });
        if (transcript && page.total !== transcript.total) {
          throw new Error('Topic changed during export. Retry after the run finishes.');
        }
        transcript ??= page;
        items.push(...page.items);
        if (page.items.length === 0 && items.length < (transcript.total ?? 0)) {
          throw new Error(
            'Topic transcript ended before all messages were retrieved. Retry export.',
          );
        }
      } while (items.length < (transcript.total ?? 0));
      const output = `${JSON.stringify(toAtif({ ...transcript, items }), null, 2)}\n`;
      if (options.output && options.output !== '-') {
        await writeFile(options.output, output, 'utf8');
      } else {
        process.stdout.write(output);
      }
    });
}
