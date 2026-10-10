import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { timeAgo } from '../../utils/format';
import {
  DEFAULT_LIMIT,
  formatSingleLine,
  MAX_LIMIT,
  type Pagination,
  renderMessage,
  resolvePagination,
  type TranscriptMessage,
} from '../topic/view';

interface ThreadViewOptions {
  from?: string;
  json?: boolean;
  limit?: string;
  messages?: boolean;
  to?: string;
  workspace?: string;
}

interface ThreadDetail {
  id: string;
  status?: string | null;
  title?: string | null;
  topicId?: string | null;
  type?: string | null;
  updatedAt?: Date | string | null;
}

const renderThreadHeader = (thread: ThreadDetail) => {
  const id = formatSingleLine(thread.id);
  const title = formatSingleLine(thread.title || 'Untitled');

  console.log('');
  console.log(`${pc.bold('Thread:')}  ${pc.cyan(title)}  ${pc.dim(`(${id})`)}`);
  if (thread.type) console.log(`${pc.bold('Type:')}    ${formatSingleLine(thread.type)}`);
  if (thread.status) console.log(`${pc.bold('Status:')}  ${formatSingleLine(thread.status)}`);
  if (thread.topicId) console.log(`${pc.bold('Topic:')}   ${formatSingleLine(thread.topicId)}`);
  if (thread.updatedAt) console.log(`${pc.bold('Updated:')} ${timeAgo(thread.updatedAt)}`);
  console.log('');
};

export function registerThreadViewCommand(thread: Command) {
  thread
    .command('view <id>')
    .description('View thread details and its messages')
    .option('-L, --limit <n>', `Number of messages to show (default: 50, max: ${MAX_LIMIT})`)
    .option('--from <n>', 'Show messages starting from this index (1-based)', '1')
    .option('--to <n>', 'Show messages up to this index (inclusive)')
    .option('--no-messages', 'Skip messages, show thread metadata only')
    .option('--json', 'Output JSON')
    .option(
      '--workspace <id>',
      "Read the thread from this workspace (overrides LOBEHUB_WORKSPACE_ID and 'workspace use')",
    )
    .action(async (id: string, options: ThreadViewOptions) => {
      const includeMessages = options.messages !== false;
      const pagination: Pagination = includeMessages
        ? resolvePagination(options)
        : { from: 1, limit: DEFAULT_LIMIT, offset: 0 };
      const client = await getTrpcClient(options.workspace);
      const result = await client.thread.getThreadTranscript.query({
        includeMessages,
        limit: pagination.limit,
        offset: pagination.offset,
        threadId: id,
      });

      const messages = result.items as TranscriptMessage[];
      const threadDetail = result.thread as ThreadDetail;
      const total = result.total ?? 0;
      const displayedTo = messages.length > 0 ? pagination.from + messages.length - 1 : null;

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              messages,
              pagination: includeMessages
                ? {
                    from: pagination.from,
                    limit: pagination.limit,
                    to: displayedTo,
                    total,
                  }
                : null,
              thread: threadDetail,
            },
            null,
            2,
          ),
        );
        return;
      }

      renderThreadHeader(threadDetail);

      if (!includeMessages) {
        console.log(pc.dim('  (messages skipped)'));
        return;
      }

      if (messages.length === 0) {
        console.log(
          pc.dim(
            total === 0
              ? '  (no messages)'
              : `  (no messages in requested range; thread has ${total} messages)`,
          ),
        );
        return;
      }

      for (const message of messages) renderMessage(message);

      console.log('');
      const next =
        displayedTo !== null && displayedTo < total
          ? ` Next: --from ${displayedTo + 1} -L ${pagination.limit}`
          : '';
      console.log(pc.dim(`  Showing ${pagination.from}–${displayedTo} of ${total}.${next}`));
    });
}
