import fs from 'node:fs';

import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient, type TrpcClient } from '../api/client';
import {
  PERSONAL_SCOPE_ENV_VALUE,
  resolveWorkspaceScope,
  type WorkspaceScope,
} from '../api/workspace';
import {
  listWorkspaces,
  resolveWorkspace,
  resolveWorkspaceRef,
  type WorkspaceRow,
} from '../api/workspaceRef';
import { resolveIdentityFingerprint } from '../auth/identity';
import { CLI_PRIMARY_BIN } from '../constants/identity';
import { type ActiveWorkspaceRecord, resolveServerUrl, saveActiveWorkspace } from '../settings';
import { formatCost, outputJson, printTable, timeAgo, timeUntil, truncate } from '../utils/format';
import { log } from '../utils/logger';
import { workspaceUrl } from './resourceUrl';

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
    : scope.source === 'env'
      ? pc.dim(`personal (from LOBEHUB_WORKSPACE_ID=${PERSONAL_SCOPE_ENV_VALUE})`)
      : pc.dim(SCOPE_HINTS[scope.source === 'stale' ? 'stale' : 'personal']);

/**
 * Every workspace-scoped read goes through the workspace header, so a command
 * that forgets `--workspace` while the CLI sits in personal scope silently
 * queries the wrong tenant. Fail loudly instead, and say how to fix it.
 * An explicit id or slug is resolved against the caller's workspaces first.
 */
const requireScope = async (explicit?: string): Promise<string> => {
  const scope = resolveWorkspaceScope(await resolveWorkspaceRef(explicit));
  if (scope.workspaceId) return scope.workspaceId;

  log.error(
    `No workspace scope. Pass --workspace <id|slug>, or run '${CLI_PRIMARY_BIN} workspace use <id|slug>' first.`,
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

type MemberRow = Awaited<ReturnType<TrpcClient['workspaceMember']['list']['query']>>[number];

const PROFILE_FIELDS = ['title', 'responsibilities'] as const;
type ProfileField = (typeof PROFILE_FIELDS)[number];

/** One row of a profile write: `null` clears a field, a missing key keeps it. */
interface MemberProfilePatch {
  member: string;
  responsibilities?: string | null;
  title?: string | null;
}

interface MemberProfileResult {
  error?: string;
  name: string | null;
  responsibilities: string | null;
  status: 'failed' | 'unchanged' | 'updated' | 'would-update';
  title: string | null;
  userId: string;
}

/** Mirror the server: trimmed, and blank means "clear". */
const normalizeProfileValue = (value: string | null | undefined) => {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * Read `[{ member, title?, responsibilities? }, …]`. Every entry is checked
 * before anything is sent, so a typo on row 15 cannot leave rows 1–14 written.
 */
const readProfilePatchFile = (file: string): MemberProfilePatch[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    log.error(`Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (!Array.isArray(parsed)) {
    log.error(`${file} must hold a JSON array of { member, title?, responsibilities? } objects.`);
    process.exit(1);
  }

  return parsed.map((entry: unknown, index): MemberProfilePatch => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const fail = (reason: string): never => {
      log.error(`${file} entry #${index + 1}: ${reason}`);
      process.exit(1);
    };

    if (typeof row.member !== 'string' || !row.member.trim())
      fail('"member" must be a user id, username or email.');
    for (const field of PROFILE_FIELDS)
      if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string')
        fail(`"${field}" must be a string or null.`);
    if (PROFILE_FIELDS.every((field) => row[field] === undefined))
      fail('provide "title" and/or "responsibilities".');

    return {
      member: row.member as string,
      responsibilities: row.responsibilities as string | null | undefined,
      title: row.title as string | null | undefined,
    };
  });
};

/** Match a member by user id, then by username or email (case-insensitive). */
const findMembers = (members: MemberRow[], ref: string): MemberRow[] => {
  const raw = ref.trim();
  const byId = members.filter((m) => m.userId === raw);
  if (byId.length > 0) return byId;

  const needle = raw.toLowerCase();
  return members.filter(
    (m) => m.user?.username?.toLowerCase() === needle || m.user?.email?.toLowerCase() === needle,
  );
};

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

      const match = await resolveWorkspace(idOrSlug);
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
      if (options.json !== undefined)
        return outputJson(
          workspaces.map((w) => ({ ...w, url: workspaceUrl(w) })),
          options.json,
        );
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
    .command('view [workspaceIdOrSlug]')
    .description('View workspace detail (defaults to the active scope)')
    .option('--json [fields]', 'Output JSON')
    .action(async (idOrSlug: string | undefined, options: { json?: boolean | string }) => {
      const scopeId = await requireScope(idOrSlug);
      const client = await getTrpcClient(scopeId);
      const detail = (await client.workspace.getById.query()) as WorkspaceRow | null;

      if (!detail) {
        log.error(`Workspace not found: ${scopeId}`);
        process.exit(1);
      }

      if (options.json !== undefined)
        return outputJson({ ...detail, url: workspaceUrl(detail) }, options.json);

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

        if (options.json !== undefined)
          return outputJson({ ...created, url: workspaceUrl(created) }, options.json);
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
    .option('-w, --workspace <id|slug>', 'Workspace to update (defaults to the active scope)')
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

        const scopeId = await requireScope(options.workspace);
        await (await getTrpcClient(scopeId)).workspace.update.mutate(patch);
        console.log('Workspace updated.');
      },
    );

  workspace
    .command('settings')
    .description('Show the workspace settings blob')
    .option('-w, --workspace <id|slug>', 'Workspace to read (defaults to the active scope)')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string; workspace?: string }) => {
      const scopeId = await requireScope(options.workspace);
      const settings = await (await getTrpcClient(scopeId)).workspace.getSettings.query();
      if (options.json !== undefined) return outputJson(settings, options.json);
      console.log(JSON.stringify(settings ?? {}, null, 2));
    });

  workspace
    .command('stats')
    .description('Show workspace-wide content statistics (admin or higher)')
    .option('-w, --workspace <id|slug>', 'Workspace to read (defaults to the active scope)')
    .option('--mine', 'Count only content you created — available to every member')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string; mine?: boolean; workspace?: string }) => {
      const scopeId = await requireScope(options.workspace);
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
    .option('-w, --workspace <id|slug>', 'Workspace to read (defaults to the active scope)')
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
        const scopeId = await requireScope(options.workspace);
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
    .option('-w, --workspace <id|slug>', 'Workspace to read (defaults to the active scope)')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string; workspace?: string }) => {
      const scopeId = await requireScope(options.workspace);
      const members = await (await getTrpcClient(scopeId)).workspaceMember.list.query({});

      if (options.json !== undefined) return outputJson(members, options.json);
      if (members.length === 0) return console.log('No members found.');

      printTable(
        members.map((m) => [
          m.userId,
          truncate(m.user?.fullName || m.user?.username || '-', 24),
          m.user?.email ?? '-',
          m.role,
          truncate(m.title || '-', 24),
          timeAgo(m.joinedAt),
        ]),
        ['USER ID', 'NAME', 'EMAIL', 'ROLE', 'TITLE', 'JOINED'],
      );
    });

  const member = workspace.command('member').description('Manage individual workspace members');

  member
    .command('update [members...]')
    .description(
      "Set members' title and responsibilities (your own, or anyone's as admin or higher)",
    )
    .option('-w, --workspace <id|slug>', 'Workspace to write (defaults to the active scope)')
    .option('-t, --title <title>', 'Job title; pass "" to clear')
    .option('-r, --responsibilities <text>', 'Responsibilities; pass "" to clear')
    .option(
      '-f, --file <path>',
      'JSON array of { member, title?, responsibilities? } to apply in one run',
    )
    .option('--dry-run', 'Show what would change without writing')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        refs: string[],
        options: {
          dryRun?: boolean;
          file?: string;
          json?: boolean | string;
          responsibilities?: string;
          title?: string;
          workspace?: string;
        },
      ) => {
        let patches: MemberProfilePatch[];
        if (options.file) {
          if (
            refs.length > 0 ||
            options.title !== undefined ||
            options.responsibilities !== undefined
          ) {
            log.error('--file carries its own members and fields; drop the other arguments.');
            process.exit(1);
          }
          patches = readProfilePatchFile(options.file);
        } else {
          if (refs.length === 0) {
            log.error('Name at least one member (user id, username or email), or pass --file.');
            process.exit(1);
          }
          if (options.title === undefined && options.responsibilities === undefined) {
            log.error('Nothing to update. Pass --title and/or --responsibilities.');
            process.exit(1);
          }
          patches = refs.map((ref) => ({
            member: ref,
            responsibilities: options.responsibilities,
            title: options.title,
          }));
        }

        const scopeId = await requireScope(options.workspace);
        const client = await getTrpcClient(scopeId);
        const members = await client.workspaceMember.list.query({}).catch((error: unknown) => {
          if (isForbidden(error)) {
            log.error(`Permission denied: you cannot read the members of workspace ${scopeId}.`);
            process.exit(1);
          }
          throw error;
        });
        // A workspace always lists at least the caller; an empty list means the
        // server did not accept this scope, which would otherwise read as
        // "no member matches" for every row.
        if (members.length === 0) {
          log.error(
            `Workspace ${scopeId} is not accessible — it does not exist or you are not a member. Nothing was written.`,
          );
          process.exit(1);
        }

        // Resolve every reference up front: an unknown or ambiguous one aborts
        // the whole run before the first write.
        const targets: { member: MemberRow; patch: MemberProfilePatch }[] = [];
        const problems: string[] = [];
        for (const patch of patches) {
          const matches = findMembers(members, patch.member);
          if (matches.length === 0) problems.push(`no member matches "${patch.member}"`);
          else if (matches.length > 1)
            problems.push(`"${patch.member}" matches ${matches.length} members — use the user id`);
          else if (targets.some((t) => t.member.userId === matches[0].userId))
            problems.push(`"${patch.member}" names ${matches[0].userId} a second time`);
          else targets.push({ member: matches[0], patch });
        }
        if (problems.length > 0) {
          for (const problem of problems) log.error(problem);
          log.error(`Nothing was written to workspace ${scopeId}.`);
          process.exit(1);
        }

        const results: MemberProfileResult[] = [];
        let forbidden = false;
        for (const { member: target, patch } of targets) {
          const name = target.user?.fullName || target.user?.username || null;
          const current = { responsibilities: target.responsibilities, title: target.title };

          // Only send fields that differ, so a re-run is a no-op rather than
          // another round of writes and audit-log entries.
          const changes: Partial<Record<ProfileField, string | null>> = {};
          for (const field of PROFILE_FIELDS) {
            const next = normalizeProfileValue(patch[field]);
            if (next !== undefined && next !== (current[field] ?? null)) changes[field] = next;
          }

          const result: MemberProfileResult = {
            name,
            ...current,
            status: 'unchanged',
            userId: target.userId,
          };
          results.push(result);

          if (Object.keys(changes).length === 0) continue;
          if (options.dryRun || forbidden) {
            Object.assign(result, changes, { status: forbidden ? 'failed' : 'would-update' });
            if (forbidden) result.error = 'skipped after a permission error';
            continue;
          }

          try {
            const updated = await client.workspaceMember.updateProfile.mutate({
              userId: target.userId,
              ...changes,
            });
            Object.assign(result, {
              responsibilities: updated.responsibilities,
              status: 'updated',
              title: updated.title,
            });
          } catch (error) {
            result.status = 'failed';
            result.error = error instanceof Error ? error.message : String(error);
            // The same check guards every other member, so stop sending.
            if (isForbidden(error)) forbidden = true;
          }
        }

        if (options.json !== undefined) outputJson(results, options.json);
        else {
          printTable(
            results.map((r) => [
              r.userId,
              truncate(r.name ?? '-', 20),
              r.status === 'failed' ? pc.red(r.status) : r.status,
              truncate(r.title ?? '-', 24),
              truncate(r.error ?? r.responsibilities ?? '-', 40),
            ]),
            ['USER ID', 'NAME', 'STATUS', 'TITLE', 'RESPONSIBILITIES'],
          );
          const count = (status: MemberProfileResult['status']) =>
            results.filter((r) => r.status === status).length;
          console.log(
            options.dryRun
              ? `\n${count('would-update')} would change, ${count('unchanged')} already up to date.`
              : `\n${count('updated')} updated, ${count('unchanged')} unchanged, ${count('failed')} failed.`,
          );
        }

        if (forbidden)
          log.error(
            `Permission denied in workspace ${scopeId}: editing another member's profile needs admin or higher.`,
          );
        if (results.some((r) => r.status === 'failed')) process.exit(1);
      },
    );

  workspace
    .command('invite <email>')
    .description('Invite a member by email (admin or higher)')
    .option('-w, --workspace <id|slug>', 'Workspace to invite into (defaults to the active scope)')
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

        const scopeId = await requireScope(options.workspace);
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
    .option('-w, --workspace <id|slug>', 'Workspace to read (defaults to the active scope)')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string; workspace?: string }) => {
      const scopeId = await requireScope(options.workspace);
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
    .option('-w, --workspace <id|slug>', 'Workspace to read (defaults to the active scope)')
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

        const scopeId = await requireScope(options.workspace);
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
