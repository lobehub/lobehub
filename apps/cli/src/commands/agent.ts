import { readFile } from 'node:fs/promises';

import { AgentGraphSchema } from '@lobechat/types/agent/graph';
import { type Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { colorStatus, readOperationStatus } from '../utils/agentRunOutcome';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import { log } from '../utils/logger';
import { resolveAgentId } from './agent/resolveAgentId';
import { registerAgentRunCommand } from './agent/run';
import { registerAgentSpaceFsCommand } from './agent/spaceFs';
import { resolveAppUrlBuilder } from './task/url';

const readGraphConfig = async (graphFile: string): Promise<unknown> => {
  const content = await readFile(graphFile, 'utf8');
  const graph = JSON.parse(content);
  const result = AgentGraphSchema.safeParse(graph);

  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new Error(`Invalid AgentGraph: ${path}${issue?.message ?? 'unknown error'}`);
  }

  return result.data;
};

const readJsonObjectFile = async (
  filePath: string,
  label: string,
): Promise<Record<string, unknown>> => {
  const content = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(content);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} JSON must be a plain object`);
  }

  return parsed as Record<string, unknown>;
};

const readAgencyConfig = (agencyConfigFile: string): Promise<Record<string, unknown>> =>
  readJsonObjectFile(agencyConfigFile, 'agencyConfig');

export function registerAgentCommand(program: Command) {
  const agent = program.command('agent').description('Manage agents');
  registerAgentSpaceFsCommand(agent);

  // ── list ──────────────────────────────────────────────

  agent
    .command('list')
    .description('List agents')
    .option('-L, --limit <n>', 'Maximum number of items', '30')
    .option('-k, --keyword <keyword>', 'Filter by keyword')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean; keyword?: string; limit?: string }) => {
      const client = await getTrpcClient();

      // The inbox (Lobe AI) is a real assistant the user can open, and this is
      // exactly where they look for it — so opt in. `queryAgents` omits the
      // product-owned inbox for callers that do not explicitly ask for it, so
      // that older clients and CRUD/group surfaces keep their old behavior.
      const input: {
        includeInbox: boolean;
        keyword?: string;
        limit?: number;
        offset?: number;
      } = { includeInbox: true };
      if (options.keyword) input.keyword = options.keyword;
      if (options.limit) input.limit = Number.parseInt(options.limit, 10);

      const result = await client.agent.queryAgents.query(input);
      const items = Array.isArray(result) ? result : ((result as any).items ?? []);

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No agents found.');
        return;
      }

      // `name` (user-facing display name) and `title` (role/identity) are separate
      // fields and both are returned — collapsing them into one column hides the
      // only handle the user knows an agent by, e.g. the inbox shows up as
      // `Sienna` / `Lobe`. `model` is not part of the queryAgents payload, so the
      // column that used to sit here was always empty.
      const rows = items.map((a: any) => [
        a.id || a.agentId || '',
        truncate(a.name || a.meta?.name || '', 24),
        truncate(a.title || a.meta?.title || '', 36),
        truncate(a.description || a.meta?.description || '', 50),
      ]);

      printTable(rows, ['ID', 'NAME', 'TITLE', 'DESCRIPTION']);
    });

  // ── view ──────────────────────────────────────────────

  agent
    .command('view [agentId]')
    .description('View agent configuration')
    .option('-s, --slug <slug>', 'Agent slug (e.g. inbox)')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        agentIdArg: string | undefined,
        options: { json?: string | boolean; slug?: string },
      ) => {
        const client = await getTrpcClient();
        const agentId = await resolveAgentId(client, { agentId: agentIdArg, slug: options.slug });
        const result = await client.agent.getAgentConfigById.query({ agentId });

        if (!result) {
          log.error(`Agent not found: ${agentId}`);
          process.exit(1);
          return;
        }

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(result, fields);
          return;
        }

        const r = result as any;
        // Same rule as the web UI (`agentDisplayName`): the personal `name` is the
        // primary label and a real (non-blank) title is the supporting line — so
        // the inbox reads `Sienna · Lobe`, while a named agent without a title
        // reads `Alice`, not `Alice · Untitled`.
        const name = (r.name || r.meta?.name)?.trim();
        const title = (r.title || r.meta?.title)?.trim();
        console.log(pc.bold(name || title || 'Untitled'));
        const meta: string[] = [];
        if (name && title && title !== name) meta.push(title);
        if (r.description || r.meta?.description) meta.push(r.description || r.meta.description);
        if (r.model) meta.push(`Model: ${r.model}`);
        if (r.provider) meta.push(`Provider: ${r.provider}`);
        if (meta.length > 0) console.log(pc.dim(meta.join(' · ')));

        if (r.systemRole) {
          console.log();
          console.log(pc.bold('System Role:'));
          console.log(r.systemRole);
        }
      },
    );

  // ── create ────────────────────────────────────────────

  agent
    .command('create')
    .description('Create a new agent')
    .option('-t, --title <title>', 'Agent title')
    .option('-d, --description <desc>', 'Agent description')
    .option('-m, --model <model>', 'Model ID')
    .option('-p, --provider <provider>', 'Provider ID')
    .option('-s, --system-role <role>', 'System role prompt')
    .option('--group <groupId>', 'Group ID')
    .action(
      async (options: {
        description?: string;
        group?: string;
        model?: string;
        provider?: string;
        systemRole?: string;
        title?: string;
      }) => {
        const client = await getTrpcClient();
        const buildUrl = await resolveAppUrlBuilder(client);

        const config: Record<string, any> = {};
        if (options.title) config.title = options.title;
        if (options.description) config.description = options.description;
        if (options.model) config.model = options.model;
        if (options.provider) config.provider = options.provider;
        if (options.systemRole) config.systemRole = options.systemRole;

        const input: Record<string, any> = { config };
        if (options.group) input.groupId = options.group;

        const result = await client.agent.createAgent.mutate(input as any);
        const r = result as any;
        const agentId = r.agentId || r.id;
        const url = buildUrl(`/agent/${encodeURIComponent(agentId)}`);
        console.log(`${pc.green('✓')} Created agent ${pc.bold(agentId)}`);
        if (r.sessionId) console.log(`  Session: ${r.sessionId}`);
        console.log(`${pc.bold('agent')}: ${url}`);
      },
    );

  // ── edit ──────────────────────────────────────────────

  agent
    .command('edit [agentId]')
    .description('Update agent configuration')
    .option('--slug <slug>', 'Agent slug (e.g. inbox)')
    .option('-t, --title <title>', 'New title')
    .option('-d, --description <desc>', 'New description')
    .option('-m, --model <model>', 'New model ID')
    .option('-p, --provider <provider>', 'New provider ID')
    .option('-s, --system-role <role>', 'New system role prompt')
    .option('--graph-file <path>', 'AgentGraph JSON file')
    .option('--enable-graph', 'Enable graph runtime')
    .option('--disable-graph', 'Disable graph runtime')
    .option(
      '--agency-config-file <path>',
      'agencyConfig JSON file, deep-merged into the agent (send `null` to clear a nested key)',
    )
    .option(
      '--config-file <path>',
      'Agent config JSON file for fields without a dedicated flag (openingMessage, openingQuestions, tags, avatar, params, chatConfig, …). Deep-merged server-side; identity fields (id/slug/userId/workspaceId/visibility) are rejected. Explicit flags win over this file.',
    )
    .option('--json [fields]', 'Output the updated agent as JSON, optionally selecting fields')
    .action(
      async (
        agentIdArg: string | undefined,
        options: {
          agencyConfigFile?: string;
          configFile?: string;
          description?: string;
          disableGraph?: boolean;
          enableGraph?: boolean;
          graphFile?: string;
          json?: string | boolean;
          model?: string;
          provider?: string;
          slug?: string;
          systemRole?: string;
          title?: string;
        },
      ) => {
        const value: Record<string, any> = {};

        // Read first so the explicit flags below overwrite it — the file is the
        // broad brush, the flags are the precise correction.
        if (options.configFile) {
          try {
            Object.assign(value, await readJsonObjectFile(options.configFile, 'agent config'));
          } catch (error) {
            log.error(`Failed to read agent config JSON: ${(error as Error).message}`);
            process.exit(1);
            return;
          }
        }

        if (options.title) value.title = options.title;
        if (options.description) value.description = options.description;
        if (options.model) value.model = options.model;
        if (options.provider) value.provider = options.provider;
        if (options.systemRole) value.systemRole = options.systemRole;

        if (options.enableGraph && options.disableGraph) {
          log.error('Use either --enable-graph or --disable-graph, not both.');
          process.exit(1);
          return;
        }

        // agencyConfig is deep-merged server-side, so a nested key is removed by
        // sending it as `null` (e.g. `{ "heterogeneousProvider": null }`); omitted keys are kept.
        if (options.agencyConfigFile) {
          try {
            value.agencyConfig = await readAgencyConfig(options.agencyConfigFile);
          } catch (error) {
            log.error(`Failed to read agencyConfig JSON: ${(error as Error).message}`);
            process.exit(1);
            return;
          }
        }

        // Graph Agent flags live on the agency config (the agent's behavior
        // body), not the chat config. Merged, not replaced: `--config-file` /
        // `--agency-config-file` may carry other agencyConfig keys and the
        // graph flags should only override the ones they own.
        const graphAgencyConfig: Record<string, any> = {};
        if (options.enableGraph) graphAgencyConfig.enableGraphMode = true;
        if (options.disableGraph) graphAgencyConfig.enableGraphMode = false;
        if (options.graphFile) {
          try {
            graphAgencyConfig.graph = await readGraphConfig(options.graphFile);
          } catch (error) {
            log.error(`Failed to read graph JSON: ${(error as Error).message}`);
            process.exit(1);
            return;
          }
        }
        if (Object.keys(graphAgencyConfig).length > 0) {
          value.agencyConfig = {
            ...(value.agencyConfig as object | undefined),
            ...graphAgencyConfig,
          };
        }

        if (Object.keys(value).length === 0) {
          log.error(
            'No changes specified. Use --title, --description, --model, --provider, --system-role, --graph-file, --enable-graph, --disable-graph, --agency-config-file, or --config-file.',
          );
          process.exit(1);
          return;
        }

        const client = await getTrpcClient();
        const agentId = await resolveAgentId(client, { agentId: agentIdArg, slug: options.slug });
        const result: any = await client.agent.updateAgentConfig.mutate({ agentId, value });

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(result?.agent ?? result, fields);
          return;
        }

        console.log(`${pc.green('✓')} Updated agent ${pc.bold(agentId)}`);
      },
    );

  // ── delete ────────────────────────────────────────────

  agent
    .command('delete <agentId>')
    .description('Delete an agent')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (agentId: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delete this agent?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.agent.removeAgent.mutate({ agentId });
      console.log(`${pc.green('✓')} Deleted agent ${pc.bold(agentId)}`);
    });

  // ── duplicate ─────────────────────────────────────────

  agent
    .command('duplicate <agentId>')
    .description('Duplicate an agent')
    .option('-t, --title <title>', 'Title for the duplicate')
    .action(async (agentId: string, options: { title?: string }) => {
      const client = await getTrpcClient();
      const input: Record<string, any> = { agentId };
      if (options.title) input.newTitle = options.title;

      const result = await client.agent.duplicateAgent.mutate(input as any);
      const r = result as any;
      console.log(`${pc.green('✓')} Duplicated agent → ${pc.bold(r.agentId || r.id || 'done')}`);
    });

  // ── run ──────────────────────────────────────────────

  registerAgentRunCommand(agent);

  // ── pin / unpin ─────────────────────────────────────

  agent
    .command('pin <agentId>')
    .description('Pin an agent')
    .action(async (agentId: string) => {
      const client = await getTrpcClient();
      await client.agent.updateAgentPinned.mutate({ id: agentId, pinned: true });
      console.log(`${pc.green('✓')} Pinned agent ${pc.bold(agentId)}`);
    });

  agent
    .command('unpin <agentId>')
    .description('Unpin an agent')
    .action(async (agentId: string) => {
      const client = await getTrpcClient();
      await client.agent.updateAgentPinned.mutate({ id: agentId, pinned: false });
      console.log(`${pc.green('✓')} Unpinned agent ${pc.bold(agentId)}`);
    });

  // ── kb-files ───────────────────────────────────────

  agent
    .command('kb-files [agentId]')
    .description('List knowledge bases and files associated with an agent')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      async (
        agentIdArg: string | undefined,
        options: { json?: string | boolean; slug?: string },
      ) => {
        const client = await getTrpcClient();
        const agentId = await resolveAgentId(client, { agentId: agentIdArg, slug: options.slug });
        const items = await client.agent.getKnowledgeBasesAndFiles.query({ agentId });

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(items, fields);
          return;
        }

        const list = Array.isArray(items) ? items : [];
        if (list.length === 0) {
          console.log('No knowledge bases or files found.');
          return;
        }

        const rows = list.map((item: any) => [
          item.id || '',
          truncate(item.name || '', 40),
          item.type || '',
          item.enabled ? 'enabled' : 'disabled',
        ]);

        printTable(rows, ['ID', 'NAME', 'TYPE', 'STATUS']);
      },
    );

  // ── add-file ───────────────────────────────────────

  agent
    .command('add-file [agentId]')
    .description('Associate files with an agent')
    .option('-s, --slug <slug>', 'Agent slug')
    .requiredOption('--file-ids <ids>', 'Comma-separated file IDs')
    .option('--enabled', 'Enable files immediately')
    .action(
      async (
        agentIdArg: string | undefined,
        options: { enabled?: boolean; fileIds: string; slug?: string },
      ) => {
        const client = await getTrpcClient();
        const agentId = await resolveAgentId(client, { agentId: agentIdArg, slug: options.slug });
        const fileIds = options.fileIds.split(',').map((s) => s.trim());

        const input: Record<string, any> = { agentId, fileIds };
        if (options.enabled !== undefined) input.enabled = options.enabled;

        await client.agent.createAgentFiles.mutate(input as any);
        console.log(
          `${pc.green('✓')} Added ${fileIds.length} file(s) to agent ${pc.bold(agentId)}`,
        );
      },
    );

  // ── remove-file ────────────────────────────────────

  agent
    .command('remove-file [agentId]')
    .description('Remove a file from an agent')
    .option('-s, --slug <slug>', 'Agent slug')
    .requiredOption('--file-id <id>', 'File ID to remove')
    .action(async (agentIdArg: string | undefined, options: { fileId: string; slug?: string }) => {
      const client = await getTrpcClient();
      const agentId = await resolveAgentId(client, { agentId: agentIdArg, slug: options.slug });
      await client.agent.deleteAgentFile.mutate({ agentId, fileId: options.fileId });
      console.log(
        `${pc.green('✓')} Removed file ${pc.bold(options.fileId)} from agent ${pc.bold(agentId)}`,
      );
    });

  // ── toggle-file ────────────────────────────────────

  agent
    .command('toggle-file [agentId]')
    .description('Toggle a file on/off for an agent')
    .option('-s, --slug <slug>', 'Agent slug')
    .requiredOption('--file-id <id>', 'File ID')
    .option('--enable', 'Enable the file')
    .option('--disable', 'Disable the file')
    .action(
      async (
        agentIdArg: string | undefined,
        options: { disable?: boolean; enable?: boolean; fileId: string; slug?: string },
      ) => {
        const enabled = options.enable ? true : options.disable ? false : undefined;
        const client = await getTrpcClient();
        const agentId = await resolveAgentId(client, { agentId: agentIdArg, slug: options.slug });
        await client.agent.toggleFile.mutate({ agentId, enabled, fileId: options.fileId });
        console.log(
          `${pc.green('✓')} Toggled file ${pc.bold(options.fileId)} for agent ${pc.bold(agentId)}`,
        );
      },
    );

  // ── add-kb ─────────────────────────────────────────

  agent
    .command('add-kb [agentId]')
    .description('Associate a knowledge base with an agent')
    .option('-s, --slug <slug>', 'Agent slug')
    .requiredOption('--kb-id <id>', 'Knowledge base ID')
    .option('--enabled', 'Enable immediately')
    .action(
      async (
        agentIdArg: string | undefined,
        options: { enabled?: boolean; kbId: string; slug?: string },
      ) => {
        const client = await getTrpcClient();
        const agentId = await resolveAgentId(client, { agentId: agentIdArg, slug: options.slug });
        const input: Record<string, any> = { agentId, knowledgeBaseId: options.kbId };
        if (options.enabled !== undefined) input.enabled = options.enabled;

        await client.agent.createAgentKnowledgeBase.mutate(input as any);
        console.log(
          `${pc.green('✓')} Added knowledge base ${pc.bold(options.kbId)} to agent ${pc.bold(agentId)}`,
        );
      },
    );

  // ── remove-kb ──────────────────────────────────────

  agent
    .command('remove-kb [agentId]')
    .description('Remove a knowledge base from an agent')
    .option('-s, --slug <slug>', 'Agent slug')
    .requiredOption('--kb-id <id>', 'Knowledge base ID')
    .action(async (agentIdArg: string | undefined, options: { kbId: string; slug?: string }) => {
      const client = await getTrpcClient();
      const agentId = await resolveAgentId(client, { agentId: agentIdArg, slug: options.slug });
      await client.agent.deleteAgentKnowledgeBase.mutate({
        agentId,
        knowledgeBaseId: options.kbId,
      });
      console.log(
        `${pc.green('✓')} Removed knowledge base ${pc.bold(options.kbId)} from agent ${pc.bold(agentId)}`,
      );
    });

  // ── toggle-kb ──────────────────────────────────────

  agent
    .command('toggle-kb [agentId]')
    .description('Toggle a knowledge base on/off for an agent')
    .option('-s, --slug <slug>', 'Agent slug')
    .requiredOption('--kb-id <id>', 'Knowledge base ID')
    .option('--enable', 'Enable the knowledge base')
    .option('--disable', 'Disable the knowledge base')
    .action(
      async (
        agentIdArg: string | undefined,
        options: { disable?: boolean; enable?: boolean; kbId: string; slug?: string },
      ) => {
        const enabled = options.enable ? true : options.disable ? false : undefined;
        const client = await getTrpcClient();
        const agentId = await resolveAgentId(client, { agentId: agentIdArg, slug: options.slug });
        await client.agent.toggleKnowledgeBase.mutate({
          agentId,
          enabled,
          knowledgeBaseId: options.kbId,
        });
        console.log(
          `${pc.green('✓')} Toggled knowledge base ${pc.bold(options.kbId)} for agent ${pc.bold(agentId)}`,
        );
      },
    );

  // ── status ──────────────────────────────────────────

  agent
    .command('status <operationId>')
    .description('Check agent operation status')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .option('--history', 'Include step history')
    .option('--history-limit <n>', 'Number of history entries', '10')
    .action(
      async (
        operationId: string,
        options: { history?: boolean; historyLimit?: string; json?: string | boolean },
      ) => {
        const client = await getTrpcClient();

        const input: Record<string, any> = { operationId };
        if (options.history) input.includeHistory = true;
        if (options.historyLimit) input.historyLimit = Number.parseInt(options.historyLimit, 10);

        const result = await client.aiAgent.getOperationStatus.query(input as any);
        const r = result as any;

        if (options.json !== undefined) {
          const fields = typeof options.json === 'string' ? options.json : undefined;
          outputJson(r, fields);
          return;
        }

        if (!r) {
          log.error(
            `No status for operation ${operationId} (unknown id, not visible to this account, or its run state already expired).`,
          );
          process.exit(1);
          return;
        }

        const read = readOperationStatus(r);
        console.log(pc.bold('Operation Status'));
        console.log(`  ID:     ${operationId}`);
        console.log(`  Status: ${colorStatus(read.status || 'unknown')}`);

        if (read.stepCount !== undefined) console.log(`  Steps:  ${read.stepCount}`);
        if (read.usage?.total_tokens) console.log(`  Tokens: ${read.usage.total_tokens}`);
        if (read.cost?.total !== undefined) console.log(`  Cost:   $${read.cost.total.toFixed(4)}`);
        if (read.error) console.log(`  Error:  ${pc.red(read.error)}`);
        if (r.createdAt) console.log(`  Started: ${r.createdAt}`);
        if (r.completedAt) console.log(`  Ended:   ${r.completedAt}`);
      },
    );

  // ── interrupt ──────────────────────────────────────────

  // Mirrors the server's InterruptTaskSchema: all three ids are optional, but
  // at least one of operationId / threadId must be provided.
  agent
    .command('interrupt')
    .description('Interrupt a running agent operation')
    .option('--operation-id <id>', 'Operation ID to interrupt')
    .option('--thread-id <id>', 'Thread ID (resolves the operation from thread metadata)')
    .option('--topic-id <id>', 'Topic ID (enables remote device cancellation when applicable)')
    .option('--json', 'Output JSON envelope')
    .action(
      async (options: {
        json?: boolean;
        operationId?: string;
        threadId?: string;
        topicId?: string;
      }) => {
        if (!options.operationId && !options.threadId) {
          throw new InvalidArgumentError('Either --thread-id or --operation-id must be provided');
        }

        const client = await getTrpcClient();
        const input: Record<string, any> = {};
        if (options.operationId) input.operationId = options.operationId;
        if (options.threadId) input.threadId = options.threadId;
        if (options.topicId) input.topicId = options.topicId;

        const result = await client.aiAgent.interruptTask.mutate(input as any);

        if (options.json) {
          outputJson(result);
          return;
        }

        const r = result as any;
        const label = r?.operationId ?? options.operationId ?? options.threadId;
        if (r?.success) {
          console.log(`${pc.green('OK')} Interrupted operation ${pc.bold(label)}`);
        } else {
          console.log(
            `${pc.yellow('!')} Interrupt not acknowledged for ${pc.bold(label)} (already finished?)`,
          );
        }
      },
    );
}
