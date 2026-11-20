import {
  currentUtilization,
  isScopedWeeklyLimit,
  isSessionLimit,
  isWeeklyAllLimit,
  type QuotaLimitReading,
} from '@lobechat/heterogeneous-agents/quota';
import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../api/client';
import { getTrpcClient } from '../api/client';
import { resolveWorkspaceRef } from '../api/workspaceRef';
import { outputJson, printTable, timeAgo, timeUntil } from '../utils/format';
import { log } from '../utils/logger';

/** At or above this utilization an account is close to being benched. */
const WARNING_UTILIZATION = 80;

export type QuotaStatus = 'exhausted' | 'ok' | 'unknown' | 'warning';

export interface QuotaWindowView {
  /** `session` (5-hour), `weekly`, or `weekly:<model>` for a model-scoped weekly. */
  kind: string;
  limitType: string;
  resetsAt: string | null;
  scopeKey: string;
  /** Percent 0..100, already 0 when the window has rolled over since the reading. */
  utilization: number;
}

export interface QuotaAccountView {
  accountId: string;
  displayName: string | null;
  email: string | null;
  enabled: boolean;
  label: string | null;
  planTier: string | null;
  provider: string;
  status: QuotaStatus;
  /** When an exhausted account gets quota back; null otherwise. */
  unavailableUntil: string | null;
  /** When the newest reading was captured; null when the account has none yet. */
  updatedAt: string | null;
  windows: QuotaWindowView[];
}

const windowKind = (reading: QuotaLimitReading): string => {
  if (isSessionLimit(reading)) return 'session';
  if (isScopedWeeklyLimit(reading)) return `weekly:${reading.scopeKey}`;
  if (isWeeklyAllLimit(reading)) return 'weekly';
  return reading.scopeKey ? `${reading.limitType}:${reading.scopeKey}` : reading.limitType;
};

const toIso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);

/**
 * Fold an account's latest readings into one status. Any window at 100% benches
 * the account until the latest of those windows resets — a full weekly blocks
 * runs just as a full session does.
 */
export const buildAccountView = (
  account: any,
  readings: QuotaLimitReading[],
  now: number = Date.now(),
): QuotaAccountView => {
  let status: QuotaStatus = readings.length ? 'ok' : 'unknown';
  let unavailableUntil: number | null = null;

  const windows = readings.map((reading) => {
    const utilization = currentUtilization(reading, now);
    if (utilization >= 100 || (reading.rateLimited && utilization > 0)) {
      status = 'exhausted';
      if (reading.resetsAt) unavailableUntil = Math.max(unavailableUntil ?? 0, reading.resetsAt);
    } else if (utilization >= WARNING_UTILIZATION && status !== 'exhausted') {
      status = 'warning';
    }
    return {
      kind: windowKind(reading),
      limitType: reading.limitType,
      resetsAt: toIso(reading.resetsAt),
      scopeKey: reading.scopeKey,
      utilization,
    };
  });

  const newest = readings.reduce((max, r) => Math.max(max, r.capturedAt), 0);

  return {
    accountId: account.id,
    displayName: account.displayName ?? null,
    email: account.email ?? null,
    enabled: account.enabled ?? true,
    label: account.label ?? null,
    planTier: account.planTier ?? null,
    provider: account.provider,
    status,
    unavailableUntil: toIso(unavailableUntil),
    updatedAt: toIso(newest),
    windows,
  };
};

const loadAccountViews = async (client: TrpcClient, accounts: any[]) =>
  Promise.all(
    accounts.map(async (account) =>
      buildAccountView(
        account,
        (await client.agentQuota.getLatestReadings.query({ accountId: account.id })) as any,
      ),
    ),
  );

const accountName = (view: QuotaAccountView) =>
  view.label || view.email || view.displayName || view.accountId;

const formatStatus = (view: QuotaAccountView) => {
  switch (view.status) {
    case 'exhausted': {
      return pc.red(
        view.unavailableUntil
          ? `exhausted (resets ${timeUntil(view.unavailableUntil)})`
          : 'exhausted',
      );
    }
    case 'warning': {
      return pc.yellow('warning');
    }
    case 'ok': {
      return pc.green('ok');
    }
    default: {
      return pc.dim('no data');
    }
  }
};

const formatWindow = (view: QuotaAccountView, kind: string) => {
  const window = view.windows.find((w) => w.kind === kind);
  if (!window) return '-';
  const reset = window.resetsAt ? pc.dim(` ${timeUntil(window.resetsAt)}`) : '';
  return `${window.utilization}%${reset}`;
};

const formatScopedWeekly = (view: QuotaAccountView) =>
  view.windows
    .filter((w) => w.kind.startsWith('weekly:'))
    .map((w) => `${w.scopeKey} ${w.utilization}%`)
    .join(', ') || '-';

const printAccountTable = (views: QuotaAccountView[]) => {
  printTable(
    views.map((view) => [
      view.accountId,
      view.provider,
      accountName(view),
      formatWindow(view, 'session'),
      formatWindow(view, 'weekly'),
      formatScopedWeekly(view),
      formatStatus(view),
      view.updatedAt ? timeAgo(view.updatedAt) : '-',
    ]),
    ['ACCOUNT ID', 'PROVIDER', 'NAME', '5H', 'WEEKLY', 'MODEL WEEKLY', 'STATUS', 'UPDATED'],
  );
};

const emitJson = (data: unknown, json: string | boolean) =>
  outputJson(data, typeof json === 'string' ? json : undefined);

export function registerQuotaCommand(program: Command) {
  const quota = program
    .command('quota')
    .description(
      'Read subscription quota of agent runtimes (Claude Code / Codex / Kimi Code accounts)',
    );

  // ── list ──────────────────────────────────────────────

  quota
    .command('list')
    .description('List subscription accounts with their current quota windows')
    .option('--provider <provider>', 'Only this provider: claude-code, codex or kimi-code')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .option('--workspace <id|slug>', "Read the workspace's shared accounts")
    .action(async (options: { json?: string | boolean; provider?: string; workspace?: string }) => {
      const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));
      const accounts = ((await client.agentQuota.listAccounts.query()) as any[]).filter(
        (account) => !options.provider || account.provider === options.provider,
      );
      const views = await loadAccountViews(client, accounts);

      if (options.json !== undefined) return emitJson(views, options.json);

      if (views.length === 0) {
        console.log('No subscription accounts found.');
        console.log(
          pc.dim(
            'Accounts appear once a device running Claude Code / Codex / Kimi Code reports quota.',
          ),
        );
        return;
      }
      printAccountTable(views);
    });

  // ── view ──────────────────────────────────────────────

  quota
    .command('view <accountId>')
    .description('Show one account: every quota window and the agent runs spending it now')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .option('--workspace <id|slug>', 'Read the account in this workspace context')
    .action(async (accountId: string, options: { json?: string | boolean; workspace?: string }) => {
      const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));
      const accounts = (await client.agentQuota.listAccounts.query()) as any[];
      const account = accounts.find((a) => a.id === accountId);
      if (!account) {
        log.error(`Account "${accountId}" not found. Run 'lh quota list' to see accounts.`);
        process.exit(1);
        return;
      }

      const [view] = await loadAccountViews(client, [account]);
      const activeRuns = (await client.agentQuota.listActiveRuns.query({ accountId })) as any[];
      const result = { ...view, activeRuns };

      if (options.json !== undefined) return emitJson(result, options.json);

      console.log(`${pc.bold(accountName(view))} ${pc.dim(`(${view.provider})`)}`);
      console.log(`Status: ${formatStatus(view)}`);
      if (view.updatedAt) console.log(pc.dim(`Updated ${timeAgo(view.updatedAt)}`));
      console.log();
      if (view.windows.length) {
        printTable(
          view.windows.map((w) => [
            w.kind,
            `${w.utilization}%`,
            w.resetsAt ? timeUntil(w.resetsAt) : '-',
          ]),
          ['WINDOW', 'USED', 'RESETS'],
        );
      } else {
        console.log(pc.dim('No quota readings yet.'));
      }
      if (activeRuns.length) {
        console.log();
        console.log(pc.bold('Active runs'));
        printTable(
          activeRuns.map((run) => [
            run.agentTitle ?? run.agentId ?? '-',
            run.topicTitle ?? run.topicId ?? '-',
            run.lastTurnAt ? timeAgo(new Date(run.lastTurnAt)) : '-',
          ]),
          ['AGENT', 'TOPIC', 'LAST TURN'],
        );
      }
    });

  // ── agent ─────────────────────────────────────────────

  quota
    .command('agent <agentId>')
    .description(
      'Quota of the account(s) an agent runs on: the account it would use now, and every bound account',
    )
    .option('--device <deviceId>', 'Resolve the account the agent uses on this device')
    .option('--provider <provider>', 'Runtime provider: claude-code, codex or kimi-code')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .option('--workspace <id|slug>', 'Read the agent in this workspace context')
    .action(
      async (
        agentId: string,
        options: {
          device?: string;
          json?: string | boolean;
          provider?: string;
          workspace?: string;
        },
      ) => {
        const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));
        const [selected, bindings, accounts] = await Promise.all([
          client.agentQuota.selectAccountForAgent.query({
            agentId,
            deviceId: options.device,
            provider: options.provider,
          }),
          client.agentQuota.listBindings.query({ agentId }),
          client.agentQuota.listAccounts.query(),
        ]);

        const byId = new Map((accounts as any[]).map((a) => [a.id, a]));
        const boundIds = new Set<string>(
          (bindings as any[]).filter((b) => b.role !== 'disabled').map((b) => b.accountId),
        );
        if (selected?.accountId) boundIds.add(selected.accountId);
        const views = await loadAccountViews(
          client,
          [...boundIds].map((id) => byId.get(id)).filter(Boolean),
        );
        const current = views.find((v) => v.accountId === selected?.accountId) ?? null;
        const result = {
          agentId,
          current: current && { ...current, reason: selected?.reason ?? null },
          accounts: views,
        };

        if (options.json !== undefined) return emitJson(result, options.json);

        if (!views.length) {
          console.log(`No subscription account is bound to agent ${agentId}.`);
          return;
        }
        if (current) {
          console.log(
            `Current account: ${pc.bold(accountName(current))} ${pc.dim(`(${selected?.reason})`)} — ${formatStatus(current)}`,
          );
          console.log();
        }
        printAccountTable(views);
      },
    );

  // ── refresh ───────────────────────────────────────────

  quota
    .command('refresh')
    .description(
      'Sample quota on a device now (codex / kimi-code; Claude Code is reported by the desktop app)',
    )
    .requiredOption('--device <deviceId>', 'Device to sample on (see `lh device list`)')
    .requiredOption('--provider <provider>', 'codex or kimi-code')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .option('--workspace <id|slug>', 'Reach the device through this workspace context')
    .action(
      async (options: {
        device: string;
        json?: string | boolean;
        provider: string;
        workspace?: string;
      }) => {
        if (options.provider !== 'codex' && options.provider !== 'kimi-code') {
          log.error(
            `Cannot refresh "${options.provider}" on demand; only codex and kimi-code are sampled through the device.`,
          );
          process.exit(1);
          return;
        }

        const client = await getTrpcClient(await resolveWorkspaceRef(options.workspace));
        const input = { deviceId: options.device, force: true };
        const snapshot: any =
          options.provider === 'codex'
            ? await client.agentQuota.refreshCodexQuota.mutate(input)
            : await client.agentQuota.refreshKimiCodeQuota.mutate(input);

        if (options.json !== undefined) return emitJson(snapshot, options.json);

        if (!snapshot) {
          log.error(`Device "${options.device}" is not reachable.`);
          process.exit(1);
          return;
        }
        if (snapshot.status !== 'ok') {
          log.error(`Refresh failed: ${snapshot.error ?? snapshot.status}`);
          process.exit(1);
          return;
        }
        const who = snapshot.identity?.email ?? snapshot.identity?.externalAccountId ?? 'account';
        console.log(`${pc.green('✓')} Refreshed ${options.provider} quota for ${who}`);
        for (const reading of snapshot.readings ?? []) {
          const reset = reading.resetsAt
            ? pc.dim(` (resets ${timeUntil(new Date(reading.resetsAt))})`)
            : '';
          console.log(`  ${windowKind(reading)}: ${reading.utilization}%${reset}`);
        }
      },
    );
}
