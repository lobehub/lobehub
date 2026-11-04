import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../../utils/format';
import { log } from '../../utils/logger';
import { resolveUrlBuilder, resourcePath, withUrl, withUrls } from '../resourceUrl';

export function registerCommentSubcommands(comment: Command) {
  comment
    .command('list <id>')
    .description('List the comments on a task')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const { data: detail } = await client.task.detail.query({ id });
      // There is no comment list procedure; the detail activities carry them.
      const comments = (detail.activities ?? []).filter((act) => act.type === 'comment');

      if (options.json !== undefined) {
        outputJson(
          withUrls(comments, await resolveUrlBuilder(client), () => resourcePath.task(detail)),
          options.json,
        );
        return;
      }

      if (comments.length === 0) {
        log.info('No comments.');
        return;
      }

      printTable(
        comments.map((act) => [
          pc.dim(act.id ?? ''),
          act.agentId ? `🤖 ${act.agentId}` : '👤 user',
          truncate(act.content ?? '', 60),
          act.time ? timeAgo(act.time) : '',
        ]),
        ['ID', 'AUTHOR', 'CONTENT', 'CREATED'],
      );
    });

  comment
    .command('edit <commentId>')
    .description('Replace the content of a comment (markdown, with -m)')
    .usage('<commentId> -m <text> [options]')
    .option('--json [fields]', 'Output JSON')
    .action(async (commentId: string, options: { json?: string | boolean }, command: Command) => {
      // `-m` belongs to the parent `comment` command; see lifecycle.ts.
      const message: string | undefined = command.optsWithGlobals().message;
      if (!message) command.error("error: required option '-m, --message <text>' not specified");
      const client = await getTrpcClient();
      const result = await client.task.updateComment.mutate({
        commentId,
        content: message!,
      });

      if (options.json !== undefined) {
        outputJson(
          withUrl(
            result.data,
            await resolveUrlBuilder(client),
            resourcePath.task({ id: result.data.taskId }),
          ),
          options.json,
        );
        return;
      }

      log.info(`Comment ${pc.dim(commentId)} updated.`);
    });

  comment
    .command('delete <commentId>')
    .description('Delete a comment')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json [fields]', 'Output JSON')
    .action(async (commentId: string, options: { json?: string | boolean; yes?: boolean }) => {
      if (!options.yes) {
        const ok = await confirm(`Delete comment ${pc.bold(commentId)}?`);
        if (!ok) return;
      }

      const client = await getTrpcClient();
      await client.task.deleteComment.mutate({ commentId });

      if (options.json !== undefined) {
        outputJson({ deleted: true, id: commentId }, options.json);
        return;
      }

      log.info(`Comment ${pc.dim(commentId)} deleted.`);
    });
}
