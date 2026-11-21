import { readFile } from 'node:fs/promises';

import type { Command } from 'commander';

import { getTrpcClient } from '../../api/client';
import { outputJson } from '../../utils/format';
import { hasOperationToken } from './reads';

/** `lh goal report`: the wrap-up run submits the Goal report it wrote. */
export function registerGoalReportCommand(goal: Command) {
  goal
    .command('report <id>')
    .description("Submit this Goal's wrap-up report from its wrap-up run")
    .requiredOption(
      '--metadata-file <path>',
      'JSON: headline, deliverableWorkId, chapters, mainline, nextSteps, graphCursor',
    )
    .requiredOption('--content-file <path>', 'The full written report in markdown')
    .option(
      '--html-file <path>',
      'The same report as one self-contained HTML page (inline CSS/JS), shown as the report',
    )
    .option('--operation <id>', 'Defaults to LOBEHUB_OPERATION_ID')
    .option('--json', 'Output JSON')
    .action(
      async (
        id: string,
        options: {
          contentFile: string;
          htmlFile?: string;
          json?: boolean;
          metadataFile: string;
          operation?: string;
        },
      ) => {
        const operationId = options.operation ?? process.env.LOBEHUB_OPERATION_ID;
        if (!operationId) throw new Error('Current wrap-up operation ID required');
        const client = await getTrpcClient();
        const endpoint = hasOperationToken()
          ? client.goal.submitOperationReport
          : client.goal.submitReport;
        const result = await endpoint.mutate({
          id,
          operationId,
          report: {
            content: await readFile(options.contentFile, 'utf8'),
            ...(options.htmlFile ? { html: await readFile(options.htmlFile, 'utf8') } : {}),
            metadata: JSON.parse(await readFile(options.metadataFile, 'utf8')),
          },
        });
        if (options.json) outputJson(result.data);
        else console.log('Goal report recorded.');
      },
    );
}
