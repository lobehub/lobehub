import type {
  HeteroSessionDigest,
  HeteroSessionImportSource,
  HeteroSessionImportStatus,
} from '@lobechat/types';

export type SessionStatus = 'imported' | 'linked' | 'new' | 'syncable';

export type ImportRowState = { inserted: number; ok: true } | { ok: false } | 'pending' | 'running';

export const dirKeyOf = (source: HeteroSessionImportSource, workingDirectory: string) =>
  `${source}::${workingDirectory}`;

export const topicClientIdOf = (digest: HeteroSessionDigest) =>
  `${digest.source}-session-${digest.sessionId}`;

export const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
};

export const baseName = (dir: string) => dir.split('/').pop() ?? dir;

/**
 * Derive the badge status of one session from the server-side import status:
 * - linked: the session originated from a LobeHub live run — importing would duplicate it
 * - syncable: imported before, and the local transcript grew since (endAt fingerprint)
 * - imported: imported and unchanged
 */
export const deriveSessionStatus = (
  digest: HeteroSessionDigest,
  status: HeteroSessionImportStatus | undefined,
): SessionStatus => {
  if (!status) return 'new';
  if (status.linked.includes(digest.sessionId)) return 'linked';
  const imported = status.imported.find((i) => i.topicClientId === topicClientIdOf(digest));
  if (!imported) return 'new';
  if (digest.endAt && imported.sourceEndAt && digest.endAt > imported.sourceEndAt)
    return 'syncable';
  return 'imported';
};

export const selectable = (status: SessionStatus) => status === 'new' || status === 'syncable';
