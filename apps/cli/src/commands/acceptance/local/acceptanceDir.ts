import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { LocalAcceptanceInfo } from '@lobechat/utils/verify/localAcceptance';
import { LOCAL_ACCEPTANCE_FORMAT } from '@lobechat/utils/verify/localAcceptance';

// ============================================
// A local acceptance is a directory under `.acceptances/`: one subdirectory
// per immutable round, plus `acceptance.json` (its identity), `reviews.json`
// (the reviewer's decisions) and `report.html` (the rendered page).
// ============================================

export const ACCEPTANCE_FILE = 'acceptance.json';
export const REVIEWS_FILE = 'reviews.json';
export const REPORT_FILE = 'report.html';

const ROUND_FILE = 'result.json';

/** `20260101-093000-<slug>` — the timestamp `new_round` names a round with. */
const ROUND_TIMESTAMP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-|$)/;

const isRoundDir = (dir: string) => existsSync(path.join(dir, ROUND_FILE));

/**
 * The acceptance directory a path names: a round directory resolves to the
 * acceptance it belongs to; an acceptance directory is itself. `undefined`
 * when the path holds neither.
 */
export const resolveAcceptanceDir = (target: string): string | undefined => {
  const dir = path.resolve(target);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return undefined;
  if (isRoundDir(dir)) return path.dirname(dir);
  if (existsSync(path.join(dir, ACCEPTANCE_FILE)) || listRoundDirs(dir).length > 0) return dir;
  return undefined;
};

/** Round directory names, oldest first — the order `new_round`'s timestamps sort in. */
export const listRoundDirs = (acceptanceDir: string): string[] =>
  readdirSync(acceptanceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isRoundDir(path.join(acceptanceDir, entry.name)))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

/** When a round was made: its `new_round` timestamp, else the directory's mtime. */
export const roundCreatedAt = (acceptanceDir: string, roundDir: string): string => {
  const match = roundDir.match(ROUND_TIMESTAMP);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    const local = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    if (!Number.isNaN(local.getTime())) return local.toISOString();
  }
  return statSync(path.join(acceptanceDir, roundDir)).mtime.toISOString();
};

/**
 * A stable UUID-shaped id derived from its parts, so the same round, result
 * and evidence keep the same ids every time the report is rendered — the ids
 * a review decision and a circled region point at.
 */
export const localId = (...parts: string[]) => {
  const hex = createHash('sha256').update(parts.join('\0')).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/**
 * A local artifact's id: its round, its check, its place in the authored
 * `evidence` list — the coordinates `ingest` reports each upload by.
 */
export const localEvidenceId = (
  acceptanceId: string,
  dir: string,
  checkItemId: string,
  position: number,
) => localId(acceptanceId, 'evidence', dir, checkItemId, String(position));

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

export const readAcceptanceInfo = (acceptanceDir: string): LocalAcceptanceInfo | undefined => {
  const raw = readJson(path.join(acceptanceDir, ACCEPTANCE_FILE)) as
    Partial<LocalAcceptanceInfo> | undefined;
  if (!raw || typeof raw.id !== 'string') return undefined;
  return {
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    id: raw.id,
    ...(raw.remote ? { remote: raw.remote } : {}),
    requirement: typeof raw.requirement === 'string' ? raw.requirement : null,
    subjectKey: path.basename(acceptanceDir),
  };
};

export const writeAcceptanceInfo = (acceptanceDir: string, info: LocalAcceptanceInfo) => {
  const { subjectKey: _subjectKey, ...stored } = info;
  writeFileSync(
    path.join(acceptanceDir, ACCEPTANCE_FILE),
    `${JSON.stringify({ format: LOCAL_ACCEPTANCE_FORMAT, ...stored }, null, 2)}\n`,
  );
};

/**
 * The acceptance's identity, minted on first use. The requirement is the
 * durable goal of the whole acceptance and, as on LobeHub, is recorded once:
 * a later, different one is reported back instead of overwriting it.
 */
export const ensureAcceptanceInfo = (
  acceptanceDir: string,
  requirement?: string,
): { info: LocalAcceptanceInfo; keptRequirement?: string } => {
  const existing = readAcceptanceInfo(acceptanceDir);
  const wanted = requirement?.trim() || undefined;
  if (existing) {
    if (!existing.requirement && wanted) {
      const info = { ...existing, requirement: wanted };
      writeAcceptanceInfo(acceptanceDir, info);
      return { info };
    }
    const keptRequirement =
      wanted && existing.requirement && wanted !== existing.requirement
        ? existing.requirement
        : undefined;
    return { info: existing, keptRequirement };
  }

  const info: LocalAcceptanceInfo = {
    createdAt: new Date().toISOString(),
    id: randomUUID(),
    requirement: wanted ?? null,
    subjectKey: path.basename(acceptanceDir),
  };
  writeAcceptanceInfo(acceptanceDir, info);
  return { info };
};
