import fs from 'node:fs';

import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';

export function registerTopicCommand(program: Command) {
  const topic = program.command('topic').description('Manage conversation topics');

  // ── list ──────────────────────────────────────────────

  topic
    .command('list')
    .description('List topics')
    .option('--agent-id <id>', 'Filter by agent ID')
    .option('-L, --limit <n>', 'Page size', '30')
    .option('-P, --page <n>', 'Page number', '1')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (options: {
        agentId?: string;
        json?: string | boolean;
        limit?: string;
        page?: string;
      }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {};
        if (options.agentId) input.agentId = options.agentId;
        if (options.limit) input.pageSize = Number.parseInt(options.limit, 10);
        const page = options.page ? Number.parseInt(options.page, 10) : undefined;
        if (page !== undefined && page > 1) input.current = page - 1;

        const result = await client.topic.getTopics.query(input as any);
        const items = Array.isArray(result) ? result : ((result as any).items ?? []);

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(items, fields);
          return;
        }

        if (items.length === 0) {
          console.log('No topics found.');
          return;
        }

        const rows = items.map((t: any) => [
          t.id || '',
          truncate(t.title || 'Untitled', 50),
          t.favorite ? '★' : '',
          t.updatedAt ? timeAgo(t.updatedAt) : '',
        ]);

        printTable(rows, ['ID', 'TITLE', 'FAV', 'UPDATED']);
      },
    );

  // ── search ────────────────────────────────────────────

  topic
    .command('search <keywords>')
    .description('Search topics')
    .option('--agent-id <id>', 'Filter by agent ID')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (keywords: string, options: { agentId?: string; json?: string | boolean }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = { keywords };
      if (options.agentId) input.agentId = options.agentId;

      const result = await client.topic.searchTopics.query(input as any);
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No topics found.');
        return;
      }

      const rows = items.map((t: any) => [t.id || '', truncate(t.title || 'Untitled', 50)]);

      printTable(rows, ['ID', 'TITLE']);
    });

  // ── create ────────────────────────────────────────────

  topic
    .command('create')
    .description('Create a topic')
    .requiredOption('-t, --title <title>', 'Topic title')
    .option('--agent-id <id>', 'Agent ID')
    .option('--favorite', 'Mark as favorite')
    .action(async (options: { agentId?: string; favorite?: boolean; title: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = { title: options.title };
      if (options.agentId) input.agentId = options.agentId;
      if (options.favorite) input.favorite = true;

      const result = await client.topic.createTopic.mutate(input as any);
      const r = result as any;
      console.log(`${pc.green('✓')} Created topic ${pc.bold(r.id || r)}`);
    });

  // ── edit ──────────────────────────────────────────────

  topic
    .command('edit <id>')
    .description('Update a topic')
    .option('-t, --title <title>', 'New title')
    .option('--favorite', 'Mark as favorite')
    .option('--no-favorite', 'Unmark as favorite')
    .action(async (id: string, options: { favorite?: boolean; title?: string }) => {
      const value: Record<string, any> = {};
      if (options.title) value.title = options.title;
      if (options.favorite !== undefined) value.favorite = options.favorite;

      if (Object.keys(value).length === 0) {
        log.error('No changes specified. Use --title or --favorite.');
        process.exit(1);
      }

      const client = await getTrpcClient();
      await client.topic.updateTopic.mutate({ id, value });
      console.log(`${pc.green('✓')} Updated topic ${pc.bold(id)}`);
    });

  // ── delete ────────────────────────────────────────────

  topic
    .command('delete [ids...]')
    .description('Delete one or more topics (pass IDs as args or via --file)')
    .option('-f, --file <path>', 'Read topic IDs from a file (one per line, or a JSON array)')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (ids: string[], options: { file?: string; yes?: boolean }) => {
      let allIds = [...ids];

      if (options.file) {
        const content = fs.readFileSync(options.file, 'utf8').trim();
        let fileIds: string[];
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            fileIds = parsed.map(String).filter(Boolean);
          } else {
            log.error('JSON file must contain an array of topic IDs.');
            process.exit(1);
          }
        } catch {
          // Not JSON, treat as one ID per line
          fileIds = content
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        }
        allIds = [...allIds, ...fileIds];
      }

      if (allIds.length === 0) {
        log.error('No topic IDs provided. Pass IDs as arguments or use --file.');
        process.exit(1);
      }

      // Deduplicate
      allIds = [...new Set(allIds)];

      if (!options.yes) {
        const confirmed = await confirm(
          `Are you sure you want to delete ${allIds.length} topic(s)?`,
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();

      if (allIds.length === 1) {
        await client.topic.removeTopic.mutate({ id: allIds[0] });
      } else {
        await client.topic.batchDelete.mutate({ ids: allIds });
      }

      console.log(`${pc.green('✓')} Deleted ${allIds.length} topic(s)`);
    });

  // ── clone ───────────────────────────────────────────

  topic
    .command('clone <id>')
    .description('Clone a topic')
    .option('-t, --title <title>', 'New title for the cloned topic')
    .action(async (id: string, options: { title?: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = { id };
      if (options.title) input.newTitle = options.title;

      const newId = await client.topic.cloneTopic.mutate(input as any);
      console.log(`${pc.green('✓')} Cloned topic → ${pc.bold(String(newId || ''))}`);
    });

  // ── share ──────────────────────────────────────────

  topic
    .command('share <id>')
    .description('Enable sharing for a topic')
    .option('--visibility <v>', 'Visibility: private or link', 'link')
    .action(async (id: string, options: { visibility?: string }) => {
      const client = await getTrpcClient();

      const input: Record<string, any> = { topicId: id };
      if (options.visibility) input.visibility = options.visibility;

      const result = await client.topic.enableSharing.mutate(input as any);
      const r = result as any;

      console.log(`${pc.green('✓')} Sharing enabled for topic ${pc.bold(id)}`);
      if (r.shareId) {
        console.log(`  Share ID: ${pc.bold(r.shareId)}`);
      }
    });

  // ── unshare ────────────────────────────────────────

  topic
    .command('unshare <id>')
    .description('Disable sharing for a topic')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      await client.topic.disableSharing.mutate({ topicId: id });
      console.log(`${pc.green('✓')} Sharing disabled for topic ${pc.bold(id)}`);
    });

  // ── share-info ─────────────────────────────────────

  topic
    .command('share-info <id>')
    .description('View sharing info for a topic')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const info = await client.topic.getShareInfo.query({ topicId: id });

      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      if (!info) {
        console.log('Sharing not enabled for this topic.');
        return;
      }

      const i = info as any;
      console.log(`${pc.bold('Topic ID:')}    ${id}`);
      if (i.shareId) console.log(`${pc.bold('Share ID:')}    ${i.shareId}`);
      if (i.visibility) console.log(`${pc.bold('Visibility:')}  ${i.visibility}`);
      if (i.createdAt) console.log(`${pc.bold('Created:')}     ${i.createdAt}`);
    });

  // ── import ─────────────────────────────────────────

  topic
    .command('import')
    .description('Import a topic')
    .requiredOption('--agent-id <id>', 'Agent ID')
    .requiredOption('--data <json>', 'Topic data as JSON string')
    .option('--group-id <id>', 'Group ID')
    .option('--json', 'Output JSON')
    .action(
      async (options: { agentId: string; data: string; groupId?: string; json?: boolean }) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = {
          agentId: options.agentId,
          data: options.data,
        };
        if (options.groupId) input.groupId = options.groupId;

        const result = await client.topic.importTopic.mutate(input as any);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`${pc.green('✓')} Topic imported successfully`);
      },
    );

  // ── recent ────────────────────────────────────────────

  topic
    .command('recent')
    .description('List recent topics')
    .option('-L, --limit <n>', 'Number of items', '10')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean; limit?: string }) => {
      const client = await getTrpcClient();
      const limit = Number.parseInt(options.limit || '10', 10);

      const result = await client.topic.recentTopics.query({ limit });
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No recent topics.');
        return;
      }

      const rows = items.map((t: any) => [
        t.id || '',
        truncate(t.title || 'Untitled', 50),
        t.updatedAt ? timeAgo(t.updatedAt) : '',
      ]);

      printTable(rows, ['ID', 'TITLE', 'UPDATED']);
    });

  // ── view ──────────────────────────────────────────────

  topic
    .command('view <id>')
    .description('View topic details and its messages')
    .option('-L, --limit <n>', 'Max messages to fetch per page', '50')
    .option('--from <n>', 'Show messages starting from this index (1-based)', '1')
    .option('--to <n>', 'Show messages up to this index (inclusive)')
    .option('--no-messages', 'Skip messages, show topic metadata only')
    .option('--json', 'Output JSON')
    .action(
      async (
        id: string,
        options: {
          from?: string;
          json?: boolean;
          limit?: string;
          messages?: boolean;
          to?: string;
        },
      ) => {
        const client = await getTrpcClient();

        // ── 1. Fetch topic detail (single query by id) ──
        const topicDetail = await client.topic.getTopicDetail.query({ id } as any);

        // ── 2. Fetch messages only when needed ──
        if (options.messages === false) {
          // --no-messages: skip message query entirely
          if (options.json) {
            console.log(JSON.stringify({ messages: [], topic: topicDetail ?? { id } }, null, 2));
            return;
          }
          console.log('');
          console.log(
            `${pc.bold('Topic:')}   ${pc.cyan((topicDetail as any)?.title ?? id)}  ${pc.dim(`(${id})`)}`,
          );
          console.log('');
          return;
        }

        const msgLimit = Number.parseInt(options.limit || '50', 10);
        const msgResult = await client.message.getMessages.query({
          pageSize: msgLimit,
          topicId: id,
        } as any);
        const allMessages: any[] = Array.isArray(msgResult)
          ? msgResult
          : ((msgResult as any).items ?? []);

        // Apply --from / --to slicing (1-based)
        const fromIdx = Math.max(1, Number.parseInt(options.from || '1', 10)) - 1;
        const toIdx = options.to ? Number.parseInt(options.to, 10) : allMessages.length;
        const messages = allMessages.slice(fromIdx, toIdx);

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                messages: messages.map((m: any) => ({
                  content: m.content ?? null,
                  createdAt: m.createdAt ?? null,
                  id: m.id,
                  parentId: m.parentId ?? null,
                  role: m.role,
                  threadId: m.threadId ?? null,
                  tools: m.tools ?? null,
                })),
                topic: { id },
              },
              null,
              2,
            ),
          );
          return;
        }

        // ── Header ──
        const t = topicDetail as any;
        console.log('');
        console.log(`${pc.bold('Topic:')}   ${pc.cyan(t?.title ?? id)}  ${pc.dim(`(${id})`)}`);
        if (t?.favorite) console.log(`${pc.bold('Favorite:')} ★`);
        if (t?.updatedAt) console.log(`${pc.bold('Updated:')}  ${timeAgo(t.updatedAt)}`);
        if (t?.status) console.log(`${pc.bold('Status:')}   ${t.status}`);
        if (t?.model) console.log(`${pc.bold('Model:')}    ${t.model}${t.provider ? ` (${t.provider})` : ''}`);
        console.log('');

        // ── Messages ──
        if (messages.length === 0) {
          console.log(pc.dim('  (no messages)'));
          return;
        }

        // Build parentId → children map for thread display
        const childrenOf = new Map<string | null, any[]>();
        for (const m of messages) {
          const key = m.parentId ?? null;
          if (!childrenOf.has(key)) childrenOf.set(key, []);
          childrenOf.get(key)!.push(m);
        }

        const printMessage = (m: any, depth: number) => {
          const indent = '  '.repeat(depth + 1);
          const roleLabel =
            m.role === 'user'
              ? pc.green('user     ')
              : m.role === 'tool'
                ? pc.yellow('tool     ')
                : pc.blue('assistant');
          const threadMark = depth > 0 ? pc.dim('↳ ') : '';

          // Full content (no truncation)
          const content = (m.content || '').trim();
          if (content) {
            console.log(`${indent}${threadMark}${roleLabel}  ${content}`);
          }

          // Tool calls (assistant requesting tools)
          if (m.tools && Array.isArray(m.tools) && m.tools.length > 0) {
            for (const tool of m.tools) {
              const toolName = tool.function?.name ?? tool.id ?? 'unknown';
              const toolArgs = tool.function?.arguments
                ? (() => {
                    try {
                      return JSON.stringify(JSON.parse(tool.function.arguments), null, 2)
                        .split('\n')
                        .map((l: string) => `${indent}    ${l}`)
                        .join('\n');
                    } catch {
                      return `${indent}    ${tool.function.arguments}`;
                    }
                  })()
                : '';
              console.log(`${indent}  ${pc.yellow('⚙')} ${pc.bold(toolName)}`);
              if (toolArgs) console.log(toolArgs);
            }
          }

          // Render thread children recursively
          const children = childrenOf.get(m.id) ?? [];
          for (const child of children) {
            printMessage(child, depth + 1);
          }
        };

        // Print only top-level messages (parentId === null/undefined, or parentId not in current page)
        const msgIds = new Set(messages.map((m: any) => m.id));
        const topLevel = messages.filter(
          (m: any) => !m.parentId || !msgIds.has(m.parentId),
        );

        for (const m of topLevel) {
          printMessage(m, 0);
        }

        if (allMessages.length > msgLimit) {
          console.log('');
          console.log(
            pc.dim(
              `  … total ${allMessages.length} messages, showing ${fromIdx + 1}–${Math.min(toIdx, allMessages.length)}. Use -L / --from / --to to paginate.`,
            ),
          );
        }
      },
    );
}
