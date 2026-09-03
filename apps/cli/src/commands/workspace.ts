import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { resolveWorkspaceScope, type WorkspaceScope } from '../api/workspace';
import { resolveIdentityFingerprint } from '../auth/identity';
import { CLI_PRIMARY_BIN } from '../constants/identity';
import { type ActiveWorkspaceRecord, resolveServerUrl, saveActiveWorkspace } from '../settings';
import { formatCost, outputJson, printTable, timeAgo, timeUntil, truncate } from '../utils/format';
import { log } from '../utils/logger';

interface WorkspaceRow {
  id: string;
  lockedOut?: boolean;
  name: string;
  plan?: string;
  role?: string | null;
  slug: string;
  updatedAt?: Date | string;
}

const SCOPE_HINTS: Record<WorkspaceScope['source'], string> = {
  env: 'LOBEHUB_WORKSPACE_ID',
  explicit: '--workspace',
  personal: 'personal (no workspace scope)',
  settings: `${CLI_PRIMARY_BIN} workspace use`,
  stale: 'personal (saved scope ignored — see the warning above)',
};

const describeScope = (scope: WorkspaceScope): string =>
  scope.workspaceId
    ? `workspace ${scope.workspaceId} ${pc.dim(`(from ${SCOPE_HINTS[scope.source]})`)}`
    : pc.dim(SCOPE_HINTS[scope.source === 'stale' ? 'stale' : 'personal']);

/**
 * Every workspace-scoped read goes through the workspace header, so a command
 * that forgets `--workspace` while the CLI sits in personal scope silently
 * queries the wrong tenant. Fail loudly instead, and say how to fix it.
 */
const requireScope = (explicit?: string): string => {
  const scope = resolveWorkspaceScope(explicit);
  if (scope.workspaceId) return scope.workspaceId;

  log.error(
    `No workspace scope. Pass --workspace <id>, or run '${CLI_PRIMARY_BIN} workspace use <id|slug>' first.`,
  );
  process.exit(1);
};

/**
 * `LOBEHUB_WORKSPACE_ID` outranks the persisted scope, so writing the file
 * changes nothing until it is unset. Saying so is the difference between the
 * user believing they switched and their next mutation hitting another tenant.
 */
const warnIfEnvOverridesPersistedScope = (): void => {
  const fromEnv = process.env.LOBEHUB_WORKSPACE_ID;
  if (!fromEnv) return;

  log.warn(
    `LOBEHUB_WORKSPACE_ID=${fromEnv} is set and takes precedence — commands keep running against that workspace until you unset it.`,
  );
};

/**
 * Bind the scope to the account and server it was chosen under, so it stops
 * applying the moment either changes rather than silently targeting a tenant
 * the current identity has no membership in.
 */
const persistScope = (workspaceId: string): void => {
  const identity = resolveIdentityFingerprint();
  if (!identity) {
    // API-key mode has no local account identity to bind to, so there is no way
    // to tell later whether the saved scope still belongs to the caller.
    log.error(
      `Cannot save a scope for these credentials. Run '${CLI_PRIMARY_BIN} login', or set LOBEHUB_WORKSPACE_ID for this session.`,
    );
    process.exit(1);
  }

  const record: ActiveWorkspaceRecord = { identity, serverUrl: resolveServerUrl(), workspaceId };
  saveActiveWorkspace(record);
};

const isForbidden = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { data?: { code?: string } }).data?.code === 'FORBIDDEN';

const listWorkspaces = async (): Promise<WorkspaceRow[]> => {
  const client = await getTrpcClient();
  return (await client.workspace.list.query()) as WorkspaceRow[];
};

/** Accept either a workspace id or its slug, so `lh workspace use acme` works. */
const findWorkspace = (workspaces: WorkspaceRow[], idOrSlug: string): WorkspaceRow | undefined =>
  workspaces.find((w) => w.id === idOrSlug) ?? workspaces.find((w) => w.slug === idOrSlug);

const planLabel = (workspace: WorkspaceRow): string => {
  if (!workspace.plan) return '-';
  return workspace.lockedOut ? `${workspace.plan} (inactive)` : workspace.plan;
};

export function registerWorkspaceCommand(program: Command) {
  const workspace = program
    .command('workspace')
    .alias('ws')
    .description('Manage workspaces and the workspace scope commands run under');

  // ── scope ─────────────────────────────────────────────

  workspace
    .command('current')
    .description('Show the workspace scope commands currently run under')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string }) => {
      const scope = resolveWorkspaceScope();

      if (options.json !== undefined) {
        return outputJson(
          {
            source: scope.source,
            workspaceId: scope.workspaceId ?? null,
          },
          options.json,
        );
      }

      console.log(`${pc.dim('Scope:')} ${describeScope(scope)}`);
      if (!scope.workspaceId) return;

      // Resolving the name needs a round trip, and a stale/revoked id should
      // read as a warning rather than crash the command.
      try {
        const detail = (await (
          await getTrpcClient(scope.workspaceId)
        ).workspace.getById.query()) as WorkspaceRow | null;
        // The server answers an unknown id with `null` rather than an error, so
        // without this a typo'd scope reports as healthy and every later
        // command fails somewhere else.
        if (detail) console.log(`${pc.dim('Name: ')} ${detail.name} ${pc.dim(detail.slug)}`);
        else log.warn('This workspace id did not resolve — check it with `workspace list`.');
      } catch (error) {
        // A diagnostic command should still print the scope it resolved, but
        // asserting "lost access" would bury auth, network and OSS-endpoint
        // failures behind a wrong explanation — report what actually failed.
        log.warn(
          `Could not load this workspace: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

  workspace
    .command('use [workspaceIdOrSlug]')
    .description('Set the workspace scope for subsequent commands')
    .option('--personal', 'Clear the workspace scope and go back to personal content')
    .action(async (idOrSlug: string | undefined, options: { personal?: boolean }) => {
      if (options.personal) {
        saveActiveWorkspace(null);
        console.log(`Scope set to ${pc.bold('personal')}.`);
        warnIfEnvOverridesPersistedScope();
        return;
      }

      if (!idOrSlug) {
        log.error('Provide a workspace id or slug, or pass --personal.');
        process.exit(1);
      }

      const workspaces = await listWorkspaces();
      const match = findWorkspace(workspaces, idOrSlug);

      if (!match) {
        log.error(`Workspace not found: ${idOrSlug}`);
        if (workspaces.length > 0) {
          console.log(pc.dim('Available:'));
          for (const w of workspaces) console.log(pc.dim(`  ${w.id}  ${w.slug}  ${w.name}`));
        }
        process.exit(1);
      }

      persistScope(match.id);
      console.log(`Scope set to ${pc.bold(match.name)} ${pc.dim(match.id)}.`);

      warnIfEnvOverridesPersistedScope();
    });

  // ── workspaces ────────────────────────────────────────

  workspace
    .command('list')
    .alias('ls')
    .description('List workspaces you belong to')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string }) => {
      const workspaces = await listWorkspaces();
      if (options.json !== undefined) return outputJson(workspaces, options.json);
      if (workspaces.length === 0) return console.log('No workspaces found.');

      // The marker has to follow the same precedence every other command uses,
      // or an env-set scope silently stars the wrong row.
      const activeId = resolveWorkspaceScope().workspaceId;
      printTable(
        workspaces.map((w) => [
          w.id === activeId ? `${pc.green('*')} ${w.id}` : `  ${w.id}`,
          truncate(w.name, 30),
          w.slug,
          w.role ?? '-',
          planLabel(w),
          w.updatedAt ? timeAgo(w.updatedAt) : '-',
        ]),
        ['ID', 'NAME', 'SLUG', 'ROLE', 'PLAN', 'UPDATED'],
      );
    });

  workspace
    .command('view [workspaceId]')
    .description('View workspace detail (defaults to the active scope)')
    .option('--json [fields]', 'Output JSON')
    .action(async (workspaceId: string | undefined, options: { json?: boolean | string }) => {
      const scopeId = requireScope(workspaceId);
      const client = await getTrpcClient(scopeId);
      const detail = (await client.workspace.getById.query()) as WorkspaceRow | null;

      if (!detail) {
        log.error(`Workspace not found: ${scopeId}`);
        process.exit(1);
      }

      if (options.json !== undefined) return outputJson(detail, options.json);

      const row = detail as WorkspaceRow & { description?: string | null; frozen?: boolean };
      console.log(`\n${pc.bold(row.name)} ${pc.dim(row.id)}`);
      console.log(`${pc.dim('Slug:')} ${row.slug}`);
      if (row.description) console.log(`${pc.dim('About:')} ${row.description}`);
      if (row.frozen) console.log(pc.yellow('This workspace is frozen (read-only).'));
    });

  workspace
    .command('create <name>')
    .description('Create a workspace')
    .requiredOption('-s, --slug <slug>', 'URL slug, unique across LobeHub')
    .option('-d, --description <description>', 'Description')
    .option('--avatar <avatar>', 'Avatar URL or emoji')
    .option('--use', 'Switch the CLI scope to the new workspace')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        name: string,
        options: {
          avatar?: string;
          description?: string;
          json?: boolean | string;
          slug: string;
          use?: boolean;
        },
      ) => {
        const client = await getTrpcClient();
        const created = (await client.workspace.create.mutate({
          avatar: options.avatar,
          description: options.description,
          name,
          slug: options.slug,
        })) as WorkspaceRow;

        if (options.use) persistScope(created.id);

        if (options.json !== undefined) return outputJson(created, options.json);
        console.log(`Created ${pc.bold(created.name)} ${pc.dim(created.id)}`);
        if (options.use) {
          console.log(`Scope set to ${pc.bold(created.name)}.`);
          warnIfEnvOverridesPersistedScope();
        }
      },
    );

  workspace
    .command('update')
    .description('Update workspace profile (admin or higher)')
    .option('-w, --workspace <id>', 'Workspace to update (defaults to the active scope)')
    .option('-n, --name <name>', 'Display name')
    .option('-s, --slug <slug>', 'URL slug')
    .option('-d, --description <description>', 'Description')
    .option('--avatar <avatar>', 'Avatar URL or emoji')
    .action(
      async (options: {
        avatar?: string;
        description?: string;
        name?: string;
        slug?: string;
        workspace?: string;
      }) => {
        const patch = {
          avatar: options.avatar,
          description: options.description,
          name: options.name,
          slug: options.slug,
        };

        if (Object.values(patch).every((value) => value === undefined)) {
          log.error('Nothing to update. Pass at least one of --name / --slug / --description.');
          process.exit(1);
        }

        const scopeId = requireScope(options.workspace);
        await (await getTrpcClient(scopeId)).workspace.update.mutate(patch);
        console.log('Workspace updated.');
      },
    );

  workspace
    .command('settings')
    .description('Show the workspace settings blob')
    .option('-w, --workspace <id>', 'Workspace to read (defaults to the active scope)')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string; workspace?: string }) => {
      const scopeId = requireScope(options.workspace);
      const settings = await (await getTrpcClient(scopeId)).workspace.getSettings.query();
      if (options.json !== undefined) return outputJson(settings, options.json);
      console.log(JSON.stringify(settings ?? {}, null, 2));
    });

  workspace
    .command('stats')
    .description('Show workspace-wide content statistics (admin or higher)')
    .option('-w, --workspace <id>', 'Workspace to read (defaults to the active scope)')
    .option('--mine', 'Count only content you created — available to every member')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string; mine?: boolean; workspace?: string }) => {
      const scopeId = requireScope(options.workspace);
      const client = await getTrpcClient(scopeId);
      const input = { todayStartAt: new Date(new Date().setHours(0, 0, 0, 0)).toISOString() };
      // Workspace-wide totals are Admin-or-higher; members and viewers hit a bare
      // FORBIDDEN, so point them at the query that was built for them.
      const stats = options.mine
        ? await client.workspace.getMyStatistics.query(input)
        : await client.workspace.getStatistics.query(input).catch((error: unknown) => {
            if (isForbidden(error)) {
              log.error('Workspace-wide statistics need admin access — rerun with --mine.');
              process.exit(1);
            }
            throw error;
          });

      if (options.json !== undefined) return outputJson(stats, options.json);
      if (!stats) return console.log('No statistics available.');

      console.log(`${pc.dim('Agents:  ')} ${stats.agents}`);
      console.log(`${pc.dim('Topics:  ')} ${stats.topics}`);
      console.log(
        `${pc.dim('Messages:')} ${stats.messages} ${pc.dim(`(+${stats.messagesToday} today)`)}`,
      );
    });

  workspace
    .command('usage')
    .description('Show workspace credit usage for the current billing window')
    .option('-w, --workspace <id>', 'Workspace to read (defaults to the active scope)')
    .option('--since <date>', 'Window start (ISO date)')
    .option('--until <date>', 'Window end (ISO date)')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        json?: boolean | string;
        since?: string;
        until?: string;
        workspace?: string;
      }) => {
        const scopeId = requireScope(options.workspace);
        const usage = await (
          await getTrpcClient(scopeId)
        ).workspaceUsage.getCurrentUsage.query({ since: options.since, until: options.until });

        if (options.json !== undefined) return outputJson(usage, options.json);

        const window =
          usage.since && usage.until
            ? `${usage.since.slice(0, 10)} → ${usage.until.slice(0, 10)}`
            : 'current cycle';
        console.log(`${pc.dim('Window:  ')} ${window}`);
        console.log(`${pc.dim('Balance: ')} ${formatCost(usage.remainingBalance)}`);

        if (usage.usageByType.length === 0) return console.log('No spend recorded in this window.');
        printTable(
          usage.usageByType.map((row) => [row.type, formatCost(row.spend)]),
          ['TYPE', 'SPEND'],
        );
      },
    );

  // ── members ───────────────────────────────────────────

  workspace
    .command('members')
    .description('List workspace members')
    .option('-w, --workspace <id>', 'Workspace to read (defaults to the active scope)')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string; workspace?: string }) => {
      const scopeId = requireScope(options.workspace);
      const members = await (await getTrpcClient(scopeId)).workspaceMember.list.query({});

      if (options.json !== undefined) return outputJson(members, options.json);
      if (members.length === 0) return console.log('No members found.');

      printTable(
        members.map((m) => [
          m.userId,
          truncate(m.user?.fullName || m.user?.username || '-', 24),
          m.user?.email ?? '-',
          m.role,
          timeAgo(m.joinedAt),
        ]),
        ['USER ID', 'NAME', 'EMAIL', 'ROLE', 'JOINED'],
      );
    });

  workspace
    .command('invite <email>')
    .description('Invite a member by email (admin or higher)')
    .option('-w, --workspace <id>', 'Workspace to invite into (defaults to the active scope)')
    .option('-r, --role <role>', 'Role to grant: admin | member | viewer', 'member')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        email: string,
        options: { json?: boolean | string; role: string; workspace?: string },
      ) => {
        const roles = ['admin', 'member', 'viewer'] as const;
        const role = roles.find((r) => r === options.role);
        if (!role) {
          log.error(`Invalid role: ${options.role}. Expected one of ${roles.join(', ')}.`);
          process.exit(1);
        }

        const scopeId = requireScope(options.workspace);
        const invitation = await (
          await getTrpcClient(scopeId)
        ).workspaceMember.invite.mutate({ email, role });

        if (options.json !== undefined) return outputJson(invitation, options.json);
        console.log(`Invited ${pc.bold(email)} as ${role}.`);
      },
    );

  workspace
    .command('invitations')
    .description('List pending invitations (admin or higher)')
    .option('-w, --workspace <id>', 'Workspace to read (defaults to the active scope)')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string; workspace?: string }) => {
      const scopeId = requireScope(options.workspace);
      const invitations = await (
        await getTrpcClient(scopeId)
      ).workspaceMember.listInvitations.query();

      if (options.json !== undefined) return outputJson(invitations, options.json);
      if (invitations.length === 0) return console.log('No pending invitations.');

      printTable(
        invitations.map((i) => [
          i.id,
          i.email ?? pc.dim('(link only)'),
          i.role,
          i.status,
          timeUntil(i.expiresAt),
        ]),
        ['ID', 'EMAIL', 'ROLE', 'STATUS', 'EXPIRES'],
      );
    });

  // ── audit log ─────────────────────────────────────────

  workspace
    .command('audit-log')
    .description('List workspace audit-log entries (admin or higher, Business plan)')
    .option('-w, --workspace <id>', 'Workspace to read (defaults to the active scope)')
    .option('--action <action>', 'Filter by action, for example workspace.updated')
    .option('--resource-type <type>', 'Filter by resource type')
    .option('-q, --query <text>', 'Free-text search')
    .option('--start <date>', 'Only entries at or after this ISO date')
    .option('--end <date>', 'Only entries at or before this ISO date')
    .option('-L, --limit <n>', 'Maximum rows', '30')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        action?: string;
        end?: string;
        json?: boolean | string;
        limit: string;
        query?: string;
        resourceType?: string;
        start?: string;
        workspace?: string;
      }) => {
        const limit = Number.parseInt(options.limit, 10);
        if (!Number.isFinite(limit) || limit < 1) {
          log.error(`Invalid --limit: ${options.limit}`);
          process.exit(1);
        }

        const scopeId = requireScope(options.workspace);
        const result = await (
          await getTrpcClient(scopeId)
        ).workspaceAuditLog.list.query({
          action: options.action,
          endDate: options.end,
          limit,
          q: options.query,
          resourceType: options.resourceType,
          startDate: options.start,
        });

        if (options.json !== undefined) return outputJson(result, options.json);
        if (result.items.length === 0) return console.log('No audit-log entries found.');

        printTable(
          result.items.map((item) => [
            timeAgo(item.createdAt),
            item.action,
            item.resourceType ?? '-',
            item.userId ?? '-',
          ]),
          ['WHEN', 'ACTION', 'RESOURCE', 'USER'],
        );
      },
    );
}
