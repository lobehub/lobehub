import { readFile } from 'node:fs/promises';

import { ReasoningGraphSchema } from '@lobechat/types';
import { type Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { getAgentStreamAuthInfo } from '../api/http';
import { resolveAgentGatewayUrl } from '../settings';
import {
  replayAgentEvents,
  streamAgentEvents,
  streamAgentEventsViaWebSocket,
} from '../utils/agentStream';
import { resolveLocalDeviceId } from '../utils/device';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import { log, setVerbose } from '../utils/logger';
import { resolveAgentId } from './agent/resolveAgentId';
import { registerAgentSpaceFsCommand } from './agent/spaceFs';

const readGraphConfig = async (graphFile: string): Promise<unknown> => {
  const content = await readFile(graphFile, 'utf8');
  const graph = JSON.parse(content);
  const result = ReasoningGraphSchema.safeParse(graph);

  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new Error(`Invalid ReasoningGraph: ${path}${issue?.message ?? 'unknown error'}`);
  }

  return result.data;
};

const readAgencyConfig = async (agencyConfigFile: string): Promise<Record<string, unknown>> => {
  const content = await readFile(agencyConfigFile, 'utf8');
  const parsed = JSON.parse(content);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('agencyConfig JSON must be a plain object');
  }

  return parsed as Record<string, unknown>;
};

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

      const input: { keyword?: string; limit?: number; offset?: number } = {};
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

      const rows = items.map((a: any) => [
        a.id || a.agentId || '',
        truncate(a.title || a.name || a.meta?.title || 'Untitled', 40),
        truncate(a.description || a.meta?.description || '', 50),
        a.model || '',
      ]);

      printTable(rows, ['ID', 'TITLE', 'DESCRIPTION', 'MODEL']);
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
        console.log(pc.bold(r.title || r.meta?.title || 'Untitled'));
        const meta: string[] = [];
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
        console.log(`${pc.green('✓')} Created agent ${pc.bold(r.agentId || r.id)}`);
        if (r.sessionId) console.log(`  Session: ${r.sessionId}`);
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
    .option('--graph-file <path>', 'ReasoningGraph JSON file')
    .option('--enable-graph', 'Enable graph runtime')
    .option('--disable-graph', 'Disable graph runtime')
    .option(
      '--agency-config-file <path>',
      'agencyConfig JSON file, deep-merged into the agent (send `null` to clear a nested key)',
    )
    .action(
      async (
        agentIdArg: string | undefined,
        options: {
          agencyConfigFile?: string;
          description?: string;
          disableGraph?: boolean;
          enableGraph?: boolean;
          graphFile?: string;
          model?: string;
          provider?: string;
          slug?: string;
          systemRole?: string;
          title?: string;
        },
      ) => {
        const value: Record<string, any> = {};
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

        const chatConfig: Record<string, any> = {};
        if (options.enableGraph) chatConfig.enableGraphMode = true;
        if (options.disableGraph) chatConfig.enableGraphMode = false;
        if (options.graphFile) {
          try {
            chatConfig.graph = await readGraphConfig(options.graphFile);
          } catch (error) {
            log.error(`Failed to read graph JSON: ${(error as Error).message}`);
            process.exit(1);
            return;
          }
        }
        if (Object.keys(chatConfig).length > 0) value.chatConfig = chatConfig;

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

        if (Object.keys(value).length === 0) {
          log.error(
            'No changes specified. Use --title, --description, --model, --provider, --system-role, --graph-file, --enable-graph, --disable-graph, or --agency-config-file.',
          );
          process.exit(1);
          return;
        }

        const client = await getTrpcClient();
        const agentId = await resolveAgentId(client, { agentId: agentIdArg, slug: options.slug });
        await client.agent.updateAgentConfig.mutate({ agentId, value });
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

  agent
    .command('run')
    .description('Run an agent with a prompt')
    .option('-a, --agent-id <id>', 'Agent ID')
    .option('-s, --slug <slug>', 'Agent slug')
    .option('-p, --prompt <text>', 'User prompt')
    .option('-t, --topic-id <id>', 'Reuse an existing topic')
    .option('--no-auto-start', 'Do not auto-start the agent')
    .option(
      '--device <target>',
      'Target device ID, or use "local" for the current connected device',
    )
    .option(
      '--no-headless',
      "Disable headless mode and wait for human approval on tool calls (default: headless — tools auto-run, matching the CLI's non-interactive nature)",
    )
    .option('--json', 'Output full JSON event stream')
    .option('-v, --verbose', 'Show detailed tool call info')
    .option('--replay <file>', 'Replay events from a saved JSON file (offline)')
    .option('--sse', 'Force SSE stream instead of WebSocket gateway')
    .action(
      async (options: {
        agentId?: string;
        autoStart?: boolean;
        device?: string;
        headless?: boolean;
        json?: boolean;
        prompt?: string;
        replay?: string;
        slug?: string;
        sse?: boolean;
        topicId?: string;
        verbose?: boolean;
      }) => {
        if (options.verbose) setVerbose(true);

        // Replay mode: render from saved JSON file, no network needed
        if (options.replay) {
          const data = readFileSync(options.replay, 'utf8');
          const events = JSON.parse(data);
          replayAgentEvents(events, { json: options.json, verbose: options.verbose });
          return;
        }

        if (!options.agentId && !options.slug) {
          log.error('Either --agent-id or --slug is required.');
          process.exit(1);
          return;
        }
        if (!options.prompt) {
          log.error('--prompt is required.');
          process.exit(1);
          return;
        }

        const client = await getTrpcClient();

        let deviceId: string | undefined;
        if (options.device !== undefined) {
          if (options.device === 'local') {
            deviceId = resolveLocalDeviceId();
            if (!deviceId) {
              log.error(
                "No local device found. Run 'lh connect' first, then retry with --device local.",
              );
              process.exit(1);
              return;
            }
          } else {
            deviceId = options.device;
          }

          const devices = await client.device.listDevices.query();
          const matchedDevice = devices.find(
            (device: { deviceId?: string; online?: boolean }) => device.deviceId === deviceId,
          );
          if (!matchedDevice) {
            log.error(`Device "${deviceId}" was not found. Check 'lh device list' and try again.`);
            process.exit(1);
            return;
          }
          if (!matchedDevice.online) {
            log.error(
              options.device === 'local'
                ? `Local device "${deviceId}" is not online. Reconnect with 'lh connect' and try again.`
                : `Device "${deviceId}" is not online. Bring it online and try again.`,
            );
            process.exit(1);
            return;
          }
        }

        // 1. Exec agent to get operationId
        const input: Record<string, any> = { prompt: options.prompt, trigger: 'cli' };
        if (options.agentId) input.agentId = options.agentId;
        if (deviceId) input.deviceId = deviceId;
        if (options.slug) input.slug = options.slug;
        if (options.topicId) input.appContext = { topicId: options.topicId };
        if (options.autoStart === false) input.autoStart = false;
        // commander's --no-headless sets `headless` to false. Anything else
        // (undefined, true) → headless mode is on and tool calls auto-execute.
        if (options.headless !== false) {
          input.userInterventionConfig = { approvalMode: 'headless' };
        }

        const result = await client.aiAgent.execAgent.mutate(input as any);
        const r = result as any;

        if (!r.success) {
          log.error(`Failed to start agent: ${r.error || r.message || 'Unknown error'}`);
          process.exit(1);
        }

        const operationId = r.operationId;
        if (!options.json) {
          log.info(`Operation: ${pc.dim(operationId)} · Topic: ${pc.dim(r.topicId || 'n/a')}`);
        }

        // 2. Connect to stream (WebSocket via Gateway, or fallback to SSE)
        const { serverUrl, headers, token, tokenType } = await getAgentStreamAuthInfo();
        const agentGatewayUrl = options.sse ? undefined : resolveAgentGatewayUrl();

        try {
          if (agentGatewayUrl) {
            await streamAgentEventsViaWebSocket({
              gatewayUrl: agentGatewayUrl,
              json: options.json,
              operationId,
              serverUrl,
              token,
              tokenType,
              verbose: options.verbose,
            });
          } else {
            const streamUrl = `${serverUrl}/api/agent/stream?operationId=${encodeURIComponent(operationId)}`;
            await streamAgentEvents(streamUrl, headers, {
              json: options.json,
              verbose: options.verbose,
            });
          }
        } catch (error) {
          // The live stream (gateway WS / SSE) dropped before the run finished —
          // the run is still executing server-side. Instead of failing, fall back
          // to polling the run status until it reaches a terminal state.
          if (options.json) throw error;
          log.warn(
            `Live stream unavailable (${(error as Error).message}). Polling run status every 10s…`,
          );
          await pollAgentRunStatus(client, operationId);
        }
      },
    );

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

        console.log(pc.bold('Operation Status'));
        console.log(`  ID:     ${operationId}`);
        console.log(`  Status: ${colorStatus(r.status || r.state || 'unknown')}`);

        if (r.stepCount !== undefined) console.log(`  Steps:  ${r.stepCount}`);
        if (r.usage?.total_tokens) console.log(`  Tokens: ${r.usage.total_tokens}`);
        if (r.cost?.total !== undefined) console.log(`  Cost:   $${r.cost.total.toFixed(4)}`);
        if (r.error) console.log(`  Error:  ${pc.red(r.error)}`);
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

function colorStatus(status: string): string {
  switch (status) {
    case 'completed':
    case 'success': {
      return pc.green(status);
    }
    case 'failed':
    case 'error': {
      return pc.red(status);
    }
    case 'processing':
    case 'running': {
      return pc.yellow(status);
    }
    default: {
      return pc.dim(status);
    }
  }
}

const TERMINAL_RUN_STATUSES = new Set([
  'completed',
  'done',
  'success',
  'failed',
  'error',
  'cancelled',
  'canceled',
  'aborted',
]);

/**
 * Fallback when the live stream (gateway WebSocket / SSE) drops before the run
 * finishes: the run is still executing server-side, so poll its status every 10s
 * until it reaches a terminal state (or is no longer tracked, which also means it
 * has finished). Avoids hard-exiting on a transient gateway disconnect.
 */
async function pollAgentRunStatus(
  client: Awaited<ReturnType<typeof getTrpcClient>>,
  operationId: string,
): Promise<void> {
  const POLL_MS = 10_000;
  let lastStatus = '';
  for (let i = 0; ; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    let r: any;
    try {
      r = await client.aiAgent.getOperationStatus.query({ operationId } as any);
    } catch (error) {
      log.error(`Status poll failed: ${(error as Error).message}`);
      process.exit(1);
    }

    if (!r) {
      log.info('Run is no longer tracked — finished (or expired).');
      return;
    }

    const status = r.status || r.state || 'unknown';
    if (status !== lastStatus) {
      lastStatus = status;
      const steps = r.stepCount !== undefined ? ` · ${r.stepCount} step(s)` : '';
      log.info(`Run status: ${colorStatus(status)}${steps}`);
    }

    if (TERMINAL_RUN_STATUSES.has(status)) {
      if (r.error) log.error(`Run error: ${r.error}`);
      return;
    }
  }
}
