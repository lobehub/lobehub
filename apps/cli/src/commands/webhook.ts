import type {
  InboundWebhookDeliveryItem,
  InboundWebhookDeliveryPage,
  InboundWebhookItem,
  InboundWebhookItemWithSecret,
} from '@lobechat/types';
import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../api/client';
import { getTrpcClient } from '../api/client';
import { confirm, outputJson } from '../utils/format';
import { log } from '../utils/logger';
import {
  curlUsage,
  describeError,
  printDeliveryTable,
  printWebhookDetails,
  printWebhookTable,
  targetOf,
  titleOf,
} from './webhook/format';
import type { WebhookSettingsOptions } from './webhook/input';
import { assertWebhookId, buildCreateInput, buildUpdateInput } from './webhook/input';

type JsonOption = { json?: string | boolean };

const KINDS = ['generic', 'mcp_events'] as const;

function fail(error: unknown): never {
  log.error((error as Error)?.message ?? String(error));
  process.exit(1);
}

/** Run an action, turning a local or TRPC error into a CLI error and exit code 1. */
const guarded =
  <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
  async (...args: A) => {
    try {
      await fn(...args);
    } catch (error) {
      fail(error);
    }
  };

const jsonFields = (options: JsonOption) =>
  typeof options.json === 'string' ? options.json : undefined;

async function getWebhook(client: TrpcClient, id: string): Promise<InboundWebhookItem> {
  assertWebhookId(id);
  return client.inboundWebhook.get.query({ id });
}

/**
 * Changing what a webhook runs, its key and test calls belong to custom webhooks. An MCP Events
 * subscription is made by its agent in a conversation; here it can only be viewed, checked and
 * deleted. The server rejects the rest too; this says why, and what works instead.
 */
function requireGeneric(item: InboundWebhookItem, command: string) {
  if (item.kind === 'generic') return;
  throw new Error(
    `"lh webhook ${command}" works on custom webhooks only. ${item.id} is an MCP Events subscription, made by its agent in a conversation: view it, check it (lh webhook check ${item.id}), or delete it to stop it (lh webhook delete ${item.id}).`,
  );
}

function printKey(item: InboundWebhookItem, secret: string) {
  if (item.endpoint) console.log(`${pc.dim('URL'.padEnd(6))}${item.endpoint}`);
  console.log(`${pc.dim('Key'.padEnd(6))}${secret}`);
  console.log(
    pc.yellow(
      'Store this key now: it won\'t be shown again. Callers send it as "Authorization: Bearer <key>".',
    ),
  );
}

function addSettingsOptions(command: Command) {
  return command
    .option('--name <name>', 'Display name')
    .option('--instructions <text>', 'What the agent should do with each call')
    .option(
      '--topic-mode <mode>',
      'new: each run starts a new topic; reuse: every call continues one shared topic',
    )
    .option('--topic <topicId>', 'The shared topic to continue (one of yours; implies reuse)')
    .option('--auto-approve', 'Run tools without waiting for approval')
    .option(
      '--channel <channelId>',
      "Post each run's answer to this Channel (chn_...); needs --auto-approve",
    )
    .option('--thread <threadId>', 'Post to this Thread (cht_...) of the Channel instead');
}

export function registerWebhookCommand(program: Command) {
  const webhook = program
    .command('webhook')
    .alias('webhooks')
    .description(
      'Manage inbound webhooks: custom webhook URLs that wake an agent, and MCP Events subscriptions',
    );

  // ── list ──────────────────────────────────────────────

  webhook
    .command('list')
    .description('List webhooks and MCP Events subscriptions')
    .option('--agent <agentId>', 'Only this agent')
    .option('--kind <kind>', `Only this kind: ${KINDS.join(' or ')}`)
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      guarded(async (options: JsonOption & { agent?: string; kind?: string }) => {
        if (options.kind && !(KINDS as readonly string[]).includes(options.kind))
          throw new Error(
            `Invalid --kind "${options.kind}". Expected one of: ${KINDS.join(', ')}.`,
          );
        const client = await getTrpcClient();
        const all: InboundWebhookItem[] = await client.inboundWebhook.list.query(
          options.agent ? { agentId: options.agent } : undefined,
        );
        const items = options.kind ? all.filter((item) => item.kind === options.kind) : all;

        if (options.json !== undefined) return outputJson(items, jsonFields(options));
        if (items.length === 0) {
          console.log('No webhooks found.');
          return;
        }
        printWebhookTable(items);
      }),
    );

  // ── view ──────────────────────────────────────────────

  webhook
    .command('view <id>')
    .description('Show a webhook: settings, URL, how to call it, last error')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      guarded(async (id: string, options: JsonOption) => {
        const item = await getWebhook(await getTrpcClient(), id);
        if (options.json !== undefined) return outputJson(item, jsonFields(options));
        printWebhookDetails(item);
      }),
    );

  // ── create ────────────────────────────────────────────

  addSettingsOptions(
    webhook
      .command('create')
      .description('Create a custom webhook for an agent and print its key (shown once)')
      .requiredOption('--agent <agentId>', 'Agent the webhook wakes'),
  )
    .option('--json [fields]', 'Output JSON (includes the key as "secret")')
    .action(
      guarded(async (options: WebhookSettingsOptions & JsonOption & { agent: string }) => {
        const input = buildCreateInput(options.agent, options);
        const client = await getTrpcClient();
        const { item, secret }: InboundWebhookItemWithSecret =
          await client.inboundWebhook.create.mutate(input);

        if (options.json !== undefined) return outputJson({ ...item, secret }, jsonFields(options));

        console.log(
          `${pc.green('✓')} Created webhook ${pc.bold(titleOf(item))} ${pc.dim(`(${item.id})`)}`,
        );
        printKey(item, secret);
        if (item.source.delivery) console.log(`Each run's answer is posted to ${targetOf(item)}.`);
        if (item.endpoint) {
          console.log();
          console.log(curlUsage(item.endpoint));
        }
        console.log(pc.dim(`Details and calling options: lh webhook view ${item.id}`));
      }),
    );

  // ── edit ──────────────────────────────────────────────

  addSettingsOptions(
    webhook.command('edit <id>').description('Change what a custom webhook runs and where'),
  )
    .option('--no-name', 'Clear the name')
    .option('--no-instructions', 'Clear the instructions')
    .option('--no-topic', 'Forget the picked shared topic (the webhook uses its own)')
    .option('--no-auto-approve', 'Wait for approval as your tool settings say')
    .option('--no-channel', 'Stop posting to a Channel')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      guarded(async (id: string, options: WebhookSettingsOptions & JsonOption) => {
        const client = await getTrpcClient();
        const current = await getWebhook(client, id);
        requireGeneric(current, 'edit');
        const changes = buildUpdateInput(current, options);
        const item: InboundWebhookItem = await client.inboundWebhook.update.mutate({
          id,
          ...changes,
        });

        if (options.json !== undefined) return outputJson(item, jsonFields(options));
        console.log(`${pc.green('✓')} Updated webhook ${pc.bold(titleOf(item))}`);
        console.log(`${pc.dim('Target'.padEnd(8))}${targetOf(item)}`);
      }),
    );

  // ── pause / resume ────────────────────────────────────

  const setPaused = (paused: boolean) =>
    guarded(async (id: string, options: JsonOption) => {
      const client = await getTrpcClient();
      requireGeneric(await getWebhook(client, id), paused ? 'pause' : 'resume');
      const item: InboundWebhookItem = await client.inboundWebhook.update.mutate({ id, paused });

      if (options.json !== undefined) return outputJson(item, jsonFields(options));
      console.log(
        paused
          ? `${pc.green('✓')} Paused ${pc.bold(titleOf(item))}. Calls are refused until you resume it: lh webhook resume ${id}`
          : `${pc.green('✓')} Resumed ${pc.bold(titleOf(item))}. Calls wake the agent again.`,
      );
    });

  webhook
    .command('pause <id>')
    .description('Pause a custom webhook: calls are refused until it is resumed')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(setPaused(true));

  webhook
    .command('resume <id>')
    .description('Resume a paused custom webhook')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(setPaused(false));

  // ── rotate-key ────────────────────────────────────────

  webhook
    .command('rotate-key <id>')
    .description('Issue a new key for a custom webhook; the old key stops working at once')
    .option('--yes', 'Skip confirmation prompt')
    .option('--json [fields]', 'Output JSON (includes the new key as "secret")')
    .action(
      guarded(async (id: string, options: JsonOption & { yes?: boolean }) => {
        const client = await getTrpcClient();
        const current = await getWebhook(client, id);
        requireGeneric(current, 'rotate-key');

        if (!options.yes) {
          const confirmed = await confirm(
            `Generate a new key for ${titleOf(current)}? The current key stops working right away; the URL stays the same, so every caller needs the new key.`,
          );
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const { item, secret }: InboundWebhookItemWithSecret =
          await client.inboundWebhook.rotateToken.mutate({ id });
        if (options.json !== undefined) return outputJson({ ...item, secret }, jsonFields(options));
        console.log(`${pc.green('✓')} New key for ${pc.bold(titleOf(item))}`);
        printKey(item, secret);
      }),
    );

  // ── test ──────────────────────────────────────────────

  webhook
    .command('test <id>')
    .description('Send a sample call to a custom webhook; the agent runs as it would for a caller')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      guarded(async (id: string, options: JsonOption) => {
        const client = await getTrpcClient();
        const current = await getWebhook(client, id);
        requireGeneric(current, 'test');
        if (current.status === 'paused')
          throw new Error(`The webhook is paused. Resume it first: lh webhook resume ${id}`);

        const result: { accepted: boolean; error?: string; status: number } =
          await client.inboundWebhook.sendTest.mutate({ id });
        if (options.json !== undefined) return outputJson(result, jsonFields(options));
        if (!result.accepted)
          throw new Error(
            `The test call was refused (HTTP ${result.status})${result.error ? `: ${result.error}` : ''}.`,
          );
        console.log(
          `${pc.green('✓')} Test sent (HTTP ${result.status}). The agent will run shortly; follow it with: lh webhook calls ${id}`,
        );
      }),
    );

  // ── calls ─────────────────────────────────────────────

  webhook
    .command('calls <id>')
    .description('List the calls a webhook received, newest first')
    .option('-L, --limit <n>', 'Maximum number of calls', '20')
    .option('--all', 'List every recorded call')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      guarded(async (id: string, options: JsonOption & { all?: boolean; limit: string }) => {
        assertWebhookId(id);
        const limit = options.all ? Infinity : Number.parseInt(options.limit, 10);
        if (!options.all && (!Number.isInteger(limit) || limit < 1))
          throw new Error(`Invalid --limit "${options.limit}". Expected a positive number.`);

        const client = await getTrpcClient();
        const calls: InboundWebhookDeliveryItem[] = [];
        let cursor: { createdAt: string; id: string } | undefined;
        let more = false;
        do {
          const page: InboundWebhookDeliveryPage = await client.inboundWebhook.listDeliveries.query(
            {
              id,
              ...(cursor && { cursor }),
            },
          );
          calls.push(...page.items);
          cursor = page.nextCursor;
          more = !!cursor || calls.length > limit;
        } while (cursor && calls.length < limit);
        const shown = calls.slice(0, limit);

        if (options.json !== undefined) return outputJson(shown, jsonFields(options));
        if (shown.length === 0) {
          console.log('No calls yet.');
          return;
        }
        printDeliveryTable(shown);
        if (more)
          console.log(
            pc.dim(`Showing the latest ${shown.length}. See more with --limit <n> or --all.`),
          );
      }),
    );

  // ── check ─────────────────────────────────────────────

  webhook
    .command('check <id>')
    .description('Check an MCP Events subscription with its server now, renewing or recovering it')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      guarded(async (id: string, options: JsonOption) => {
        const client = await getTrpcClient();
        const current = await getWebhook(client, id);
        if (current.kind !== 'mcp_events')
          throw new Error(
            `"lh webhook check" works on MCP Events subscriptions only. ${id} is a custom webhook: send it a test call with: lh webhook test ${id}`,
          );

        const item: InboundWebhookItem = await client.inboundWebhook.check.mutate({ id });
        if (options.json !== undefined) return outputJson(item, jsonFields(options));
        if (item.status === 'active' && !item.lastError) {
          console.log(`${pc.green('✓')} ${titleOf(item)}: the subscription is working.`);
          return;
        }
        console.log(`${pc.yellow('!')} ${titleOf(item)}: ${item.status}`);
        if (item.lastError) console.log(describeError(item.lastError));
      }),
    );

  // ── delete ────────────────────────────────────────────

  webhook
    .command('delete <id>')
    .description('Delete a webhook; an MCP Events subscription is also ended on its MCP server')
    .option('--yes', 'Skip confirmation prompt')
    .action(
      guarded(async (id: string, options: { yes?: boolean }) => {
        const client = await getTrpcClient();
        const current = await getWebhook(client, id);
        const agent = current.agent?.title || 'the agent';

        if (!options.yes) {
          const confirmed = await confirm(
            current.kind === 'generic'
              ? `Delete webhook ${titleOf(current)}? Its URL stops working at once and calls no longer wake ${agent}. This cannot be undone.`
              : `Delete the ${titleOf(current)} subscription? This also ends it on the MCP server, so ${agent} no longer runs on these events. To get them again, ask the agent to subscribe in a conversation.`,
          );
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        await client.inboundWebhook.delete.mutate({ id });
        console.log(
          current.kind === 'generic'
            ? `${pc.green('✓')} Deleted webhook ${pc.bold(titleOf(current))}`
            : `${pc.green('✓')} Deleted ${pc.bold(titleOf(current))} and ended the subscription on its MCP server`,
        );
      }),
    );
}
