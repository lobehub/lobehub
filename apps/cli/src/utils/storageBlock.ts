import type { TrpcClient } from '../api/client';

const STORAGE_BLOCK_PATTERN = /storage_block:([\w-]+)/;

/** Callers run under a tool-call deadline; a slow lookup must not outlast the rejection. */
const LOOKUP_TIMEOUT_MS = 5000;

const formatBytes = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
};

const formatQuota = (quota: { includedBytes: number; remainingBytes: number; usedBytes: number }) =>
  `${formatBytes(quota.remainingBytes)} of ${formatBytes(quota.includedBytes)} remaining (${formatBytes(quota.usedBytes)} used).`;

/**
 * Expand a `storage_block:*` rejection into one line a model or person can act
 * on: remaining quota plus the page that lifts this reason. It stays one line
 * with the code first, because callers classify on the code and the desktop app
 * reads only the CLI's last error line. Any other error passes through as is.
 * The lookups are best effort: a server that cannot answer them must not hide
 * the rejection. Without a confirmed scope it names no page, because a personal
 * link does nothing for a workspace quota.
 */
export const describeStorageBlock = async (
  client: TrpcClient,
  error: unknown,
  serverUrl: string,
): Promise<string> => {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(STORAGE_BLOCK_PATTERN);
  if (!match) return message;

  const quota = await client.file.getStorageQuota
    .query(undefined, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
    .catch(() => null);

  const workspace = quota?.workspaceId
    ? await client.workspace.getById
        .query(undefined, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
        .catch(() => null)
    : undefined;
  const workspaceSlug = workspace?.id === quota?.workspaceId ? workspace?.slug : undefined;

  const instruction =
    'Tell the user these options; do not retry or delete their files without asking';
  const workspaceNote = quota?.workspaceId
    ? 'This is the workspace quota, so a workspace owner or admin has to act. '
    : '';

  if (!quota || (quota.workspaceId && !workspaceSlug)) {
    return [
      `${match[0]}.`,
      quota ? formatQuota(quota) : '',
      `Free space in the file library or upgrade the plan of the current scope. ${workspaceNote}${instruction}`,
    ]
      .filter(Boolean)
      .join(' ');
  }

  const prefix = workspaceSlug ? `/${encodeURIComponent(workspaceSlug)}` : '';
  const base = new URL(serverUrl);
  base.username = '';
  base.password = '';
  // Cloud's API still uses app.lobehub.com; user-facing pages use lobehub.com.
  if (base.origin === 'https://app.lobehub.com') base.hostname = 'lobehub.com';
  const page = (pathname: string) => new URL(`${prefix}${pathname}`, base).toString();

  return [
    `${match[0]}.`,
    formatQuota(quota),
    `Free space: ${page('/resource')}`,
    match[1] === 'upgrade_required'
      ? `or upgrade the plan: ${page('/settings/plans')}.`
      : `or review storage settings: ${page('/settings/usage')}.`,
    `${workspaceNote}${instruction}`,
  ].join(' ');
};
