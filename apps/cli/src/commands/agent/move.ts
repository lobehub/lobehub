/**
 * `lh agent transfer ...` / `lh agent move-group ...` — where an agent lives.
 *
 * Mirrors the sidebar's "Transfer to…" and "Move to group" menu items:
 *
 * - `transfer` rehomes agents (with their topics, messages and tasks) from the
 *   current scope (`workspace use` / `LOBEHUB_WORKSPACE_ID`, else personal) to
 *   another workspace or to the personal account, via `agent.transferAgents`.
 * - `move-group` sets the sidebar group (`agents.sessionGroupId`) inside the
 *   current scope, via `home.updateAgentSessionGroupId`.
 */
import type { Command } from 'commander';
import { Option } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { resolveWorkspace } from '../../api/workspaceRef';
import { confirm, outputJson } from '../../utils/format';
import { log } from '../../utils/logger';

const TRANSFER_VISIBILITIES = ['private', 'public'] as const;
type TransferVisibility = (typeof TRANSFER_VISIBILITIES)[number];

/** Same sentinel the sidebar uses for "not in any group". */
const DEFAULT_GROUP = 'default';

interface TransferOptions {
  json?: string | boolean;
  personal?: boolean;
  to?: string;
  visibility?: TransferVisibility;
  yes?: boolean;
}

export function registerAgentMoveCommands(agent: Command) {
  // ── transfer ──────────────────────────────────────────

  agent
    .command('transfer <agentIds...>')
    .description(
      'Move agents (with their conversations) from the current scope to another workspace or your personal account',
    )
    .option('--to <workspace>', 'Target workspace id or slug')
    .option('--personal', 'Move to your personal account')
    .addOption(
      new Option(
        '--visibility <visibility>',
        'Visibility in the target workspace: `private` (only you) or `public` (workspace members)',
      ).choices(TRANSFER_VISIBILITIES),
    )
    .option('--yes', 'Skip confirmation prompt')
    .option('--json [fields]', 'Output the transfer results as JSON, optionally selecting fields')
    .action(async (agentIds: string[], options: TransferOptions) => {
      if (Boolean(options.to) === Boolean(options.personal)) {
        log.error('Specify exactly one target: --to <workspace> or --personal.');
        process.exit(1);
        return;
      }
      if (options.personal && options.visibility) {
        log.error('--visibility only applies when transferring to a workspace.');
        process.exit(1);
        return;
      }

      // Resolve before confirming so a typo fails without a prompt, and a slug
      // is never sent where the server expects an id.
      const target = options.to ? await resolveWorkspace(options.to) : null;
      // Omitting visibility makes the server keep the row's stored value, and a
      // personal agent stores `public` — so an unflagged move would share it
      // with every member. Default to `private`, as the web Transfer modal does.
      const visibility = target ? (options.visibility ?? 'private') : undefined;
      const targetLabel = target
        ? `workspace ${target.name} (${target.slug}) as ${visibility}`
        : 'personal account';

      if (!options.yes) {
        const confirmed = await confirm(
          `Transfer ${agentIds.length} agent(s) and their conversations to ${targetLabel}?`,
        );
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      const results = await client.agent.transferAgents.mutate({
        agentIds,
        targetVisibility: visibility,
        targetWorkspaceId: target?.id ?? null,
      });

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(results, fields);
        return;
      }

      for (const r of results) {
        console.log(`${pc.green('✓')} Transferred agent ${pc.bold(r.agentId)} to ${targetLabel}`);
      }
      // History is rehomed by a background job; the agents are usable now.
      const jobId = results[0]?.transferJobId;
      if (jobId)
        console.log(pc.dim(`  Conversation history is migrating in background (job ${jobId})`));
    });

  // ── move-group ────────────────────────────────────────

  agent
    .command('move-group <agentId> <groupId>')
    .description(
      `Move an agent into a sidebar group (see \`lh session-group list\`); pass \`${DEFAULT_GROUP}\` to remove it from any group`,
    )
    .action(async (agentId: string, groupId: string) => {
      const sessionGroupId = groupId === DEFAULT_GROUP ? null : groupId;

      const client = await getTrpcClient();
      const updated = await client.home.updateAgentSessionGroupId.mutate({
        agentId,
        sessionGroupId,
      });
      // The update matches no row for an unknown id or one outside the current
      // scope, and returns nothing instead of throwing.
      if (!updated) {
        log.error(`Agent not found in the current scope: ${agentId}`);
        process.exit(1);
        return;
      }

      console.log(
        sessionGroupId
          ? `${pc.green('✓')} Moved agent ${pc.bold(agentId)} to group ${pc.bold(sessionGroupId)}`
          : `${pc.green('✓')} Removed agent ${pc.bold(agentId)} from its group`,
      );
    });
}
