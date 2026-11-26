import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient, type TrpcClient } from '../../api/client';
import { confirm, outputJson } from '../../utils/format';
import { log } from '../../utils/logger';

/** Mirrors the server's `removeBatch` / `purgePreview` input caps. */
const REMOVE_BATCH_LIMIT = 200;
const PURGE_PREVIEW_LIMIT = 20;

type PurgePreview = Awaited<ReturnType<TrpcClient['acceptance']['purgePreview']['query']>>;

interface DeleteOptions {
  json?: boolean | string;
  purge?: boolean;
  yes?: boolean;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
};

const describePurge = (preview: PurgePreview): string =>
  `${preview.rounds} round(s), ${preview.fileCount} evidence file(s) ` +
  `(screenshots ${preview.files.images} · recordings ${preview.files.videos} · other ${preview.files.other}), ` +
  `${formatBytes(preview.bytes)} freed`;

/**
 * The purge preview only answers up to its cap and fails on an id the caller
 * cannot read; a missing preview never blocks the delete, the prompt just
 * says less.
 */
async function loadPurgePreview(client: TrpcClient, ids: string[]) {
  if (ids.length > PURGE_PREVIEW_LIMIT) return;
  try {
    return await client.acceptance.purgePreview.query({ ids });
  } catch {
    return;
  }
}

async function confirmDelete(client: TrpcClient, ids: string[], purge: boolean) {
  const target = ids.length === 1 ? `acceptance ${pc.bold(ids[0])}` : `${ids.length} acceptances`;
  if (!purge) {
    return confirm(
      `Delete ${target}? Its verification rounds are kept as standalone reports (use --purge to remove them too).`,
    );
  }
  const preview = await loadPurgePreview(client, ids);
  const detail = preview ? ` This removes ${describePurge(preview)}.` : '';
  return confirm(
    `Permanently delete ${target} with every round, report and evidence file?${detail} This cannot be undone.`,
  );
}

async function removeAll(client: TrpcClient, ids: string[], purge: boolean) {
  // One id goes through `remove`, so a refusal (not found, no permission, a
  // goal still waiting on this acceptance) surfaces as its own error message
  // instead of a bare failed id.
  if (ids.length === 1) {
    await client.acceptance.remove.mutate({ id: ids[0], purge });
    return { deleted: 1, failedIds: [] as string[] };
  }

  let deleted = 0;
  const failedIds: string[] = [];
  for (let i = 0; i < ids.length; i += REMOVE_BATCH_LIMIT) {
    const result = await client.acceptance.removeBatch.mutate({
      ids: ids.slice(i, i + REMOVE_BATCH_LIMIT),
      purge,
    });
    deleted += result.deleted;
    failedIds.push(...result.failedIds);
  }
  return { deleted, failedIds };
}

/**
 * `lh acceptance delete` — remove the acceptance aggregate (the review shell
 * around its rounds). By default the rounds detach and stay reachable as
 * standalone reports; `--purge` also deletes the rounds and the evidence files
 * only they referenced, matching the Web delete dialog.
 */
export function attachDeleteCommand(
  acceptance: Command,
  resolveAcceptanceId: (ref: string) => Promise<string>,
) {
  acceptance
    .command('delete <idOrSubject...>')
    .alias('rm')
    .description(
      'Delete acceptances (uuid or type:id); rounds are kept as standalone reports unless --purge',
    )
    .option('--purge', 'Also permanently delete every round, report and evidence file')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--json [fields]', 'Output JSON')
    .action(async (refs: string[], options: DeleteOptions) => {
      const ids: string[] = [];
      for (const ref of refs) ids.push(await resolveAcceptanceId(ref));
      const uniqueIds = [...new Set(ids)];
      const purge = Boolean(options.purge);
      const client = await getTrpcClient();

      if (!options.yes && !(await confirmDelete(client, uniqueIds, purge))) {
        console.log('Aborted.');
        return;
      }

      const result = await removeAll(client, uniqueIds, purge);
      if (result.failedIds.length > 0) process.exitCode = 1;

      if (options.json !== undefined) {
        outputJson(
          { ...result, purged: purge },
          typeof options.json === 'string' ? options.json : undefined,
        );
        return;
      }

      if (result.deleted > 0) {
        const what =
          uniqueIds.length === 1 ? `acceptance ${uniqueIds[0]}` : `${result.deleted} acceptance(s)`;
        console.log(
          `${pc.green('✓')} Deleted ${what}${purge ? ' with rounds and evidence' : ' — rounds kept as standalone reports'}`,
        );
      }
      for (const id of result.failedIds) log.error(`Could not delete ${id}`);
    });
}
