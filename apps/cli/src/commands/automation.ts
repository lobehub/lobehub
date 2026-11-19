import type { InboundWebhookItem } from '@lobechat/types';
import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../api/client';
import { getTrpcClient } from '../api/client';
import { confirm, outputJson } from '../utils/format';
import { printAutomationDetails, printAutomationTable, titleOf } from './automation/format';
import type { JsonOption } from './webhook/shared';
import {
  describeError,
  getInboundWebhook,
  guarded,
  jsonFields,
  requireMcpEvents,
} from './webhook/shared';

/** Longest display name the server accepts. */
const NAME_MAX = 100;

/**
 * An automation: an MCP Events subscription. The same table holds custom webhooks; those are
 * refused here with the `lh webhook` command that handles them.
 */
async function getAutomation(client: TrpcClient, id: string, command: string) {
  const item = await getInboundWebhook(client, id, 'automation');
  return { item, source: requireMcpEvents(item, command) };
}

/** The new display name, or `null` to clear it so the event shows. */
function nameInput(name: string | undefined, clear: boolean | undefined): string | null {
  if (clear) {
    if (name !== undefined) throw new Error('Pass a new name or --clear, not both.');
    return null;
  }
  const trimmed = name?.trim();
  if (!trimmed)
    throw new Error(
      'Pass the new name, or --clear to drop it and show the event. See: lh automation rename --help',
    );
  if (trimmed.length > NAME_MAX)
    throw new Error(`The name is too long: at most ${NAME_MAX} characters.`);
  return trimmed;
}

export function registerAutomationCommand(program: Command) {
  const automation = program
    .command('automation')
    .alias('automations')
    .description(
      'Manage automations: MCP Events subscriptions that run an agent on a connector event (an agent creates them in a conversation)',
    );

  // ── list ──────────────────────────────────────────────

  automation
    .command('list')
    .description('List automations (MCP Events subscriptions)')
    .option('--agent <agentId>', 'Only this agent')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      guarded(async (options: JsonOption & { agent?: string }) => {
        const client = await getTrpcClient();
        const items: InboundWebhookItem[] = await client.inboundWebhook.list.query({
          kind: 'mcp_events',
          ...(options.agent && { agentId: options.agent }),
        });

        if (options.json !== undefined) return outputJson(items, jsonFields(options));
        if (items.length === 0) {
          console.log(
            'No automations found. To make one, ask an agent in a conversation to subscribe to a connector event.',
          );
          return;
        }
        printAutomationTable(items);
      }),
    );

  // ── view ──────────────────────────────────────────────

  automation
    .command('view <id>')
    .description(
      'Show an automation: name, event, connector, filter, status, where results go, expiry',
    )
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      guarded(async (id: string, options: JsonOption) => {
        const { item, source } = await getAutomation(await getTrpcClient(), id, 'view');
        if (options.json !== undefined) return outputJson(item, jsonFields(options));
        printAutomationDetails(item, source);
      }),
    );

  // ── rename ────────────────────────────────────────────

  automation
    .command('rename <id> [name]')
    .description(
      'Rename an automation for people; the event the agent knows it by stays. --clear shows the event again',
    )
    .option('--clear', 'Drop the name; the automation shows its event')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      guarded(
        async (id: string, name: string | undefined, options: JsonOption & { clear?: boolean }) => {
          const nextName = nameInput(name, options.clear);
          const client = await getTrpcClient();
          await getAutomation(client, id, 'rename');
          const item: InboundWebhookItem = await client.inboundWebhook.update.mutate({
            id,
            name: nextName,
          });

          if (options.json !== undefined) return outputJson(item, jsonFields(options));
          console.log(
            nextName === null
              ? `${pc.green('✓')} Cleared the name: it shows as its event ${pc.bold(item.identifier)}`
              : `${pc.green('✓')} Renamed to ${pc.bold(titleOf(item))} ${pc.dim(`(event ${item.identifier}, unchanged)`)}`,
          );
        },
      ),
    );

  // ── check ─────────────────────────────────────────────

  automation
    .command('check <id>')
    .description('Check an automation with its MCP server now, renewing or recovering it')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(
      guarded(async (id: string, options: JsonOption) => {
        const client = await getTrpcClient();
        await getAutomation(client, id, 'check');

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

  automation
    .command('delete <id>')
    .description('Delete an automation; this also ends the subscription on its MCP server')
    .option('--yes', 'Skip confirmation prompt')
    .action(
      guarded(async (id: string, options: { yes?: boolean }) => {
        const client = await getTrpcClient();
        const { item: current } = await getAutomation(client, id, 'delete');
        const agent = current.agent?.title || 'the agent';

        if (!options.yes) {
          const confirmed = await confirm(
            `Delete the automation ${titleOf(current)}? This also ends it on the MCP server, so ${agent} no longer runs on these events. To get them again, ask the agent to subscribe in a conversation.`,
          );
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        await client.inboundWebhook.delete.mutate({ id });
        console.log(
          `${pc.green('✓')} Deleted ${pc.bold(titleOf(current))} and ended the subscription on its MCP server`,
        );
      }),
    );
}
