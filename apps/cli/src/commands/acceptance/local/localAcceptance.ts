import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type {
  LocalAcceptanceInfo,
  LocalAcceptanceSource,
  LocalReviewEvent,
  LocalReviewLog,
} from '@lobechat/utils/verify/localAcceptance';
import {
  LOCAL_ACCEPTANCE_FORMAT,
  mergeLocalReviewEvents,
} from '@lobechat/utils/verify/localAcceptance';

import {
  commandAcceptanceDir,
  ensureAcceptanceInfo,
  listRoundDirs,
  readAcceptanceInfo,
  resolveAcceptanceDir,
  REVIEWS_FILE,
} from './acceptanceDir';
import { type LocalRoundRead, readLocalRound } from './localRound';

/** The file name the report page saves its review log as (see `LocalReviewBar`). */
export const reviewExportPrefix = (acceptanceId: string) => `acceptance-reviews-${acceptanceId}`;

const readReviewLog = (file: string): LocalReviewLog | undefined => {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LocalReviewLog>;
    if (raw.format !== LOCAL_ACCEPTANCE_FORMAT || !Array.isArray(raw.events)) return undefined;
    return { acceptanceId: String(raw.acceptanceId ?? ''), events: raw.events, format: raw.format };
  } catch {
    return undefined;
  }
};

/** Where a browser saves the page's review log: `$XDG_DOWNLOAD_DIR`, else `~/Downloads`. */
const downloadDirs = () => {
  const dirs = [process.env.LOBEHUB_ACCEPTANCE_DOWNLOADS, process.env.XDG_DOWNLOAD_DIR];
  try {
    const userDirs = readFileSync(path.join(homedir(), '.config/user-dirs.dirs'), 'utf8');
    const match = userDirs.match(/^XDG_DOWNLOAD_DIR="?([^"\n]+)"?/m);
    if (match) dirs.push(match[1]!.replace('$HOME', homedir()));
  } catch {
    // Not a freedesktop system.
  }
  dirs.push(path.join(homedir(), 'Downloads'));
  return [...new Set(dirs.filter((dir): dir is string => Boolean(dir)))];
};

/** The newest review log the page saved for this acceptance (`… (1).json` included). */
export const findSavedReviewLog = (acceptanceId: string): string | undefined => {
  const prefix = reviewExportPrefix(acceptanceId);
  let newest: { file: string; mtime: number } | undefined;
  for (const dir of downloadDirs()) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      const mtime = statSync(file).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { file, mtime };
    }
  }
  return newest?.file;
};

/**
 * Fold a saved review log into the acceptance's `reviews.json`. Merging is by
 * event id, so reading the same download twice changes nothing.
 */
export const importReviewLog = (
  acceptanceDir: string,
  acceptanceId: string,
  file: string,
): { added: number; events: LocalReviewEvent[] } => {
  const incoming = readReviewLog(file);
  if (!incoming) throw new Error(`${file} is not an acceptance review log`);
  if (incoming.acceptanceId !== acceptanceId)
    throw new Error(`${file} holds reviews of another acceptance (${incoming.acceptanceId})`);
  const current = readReviewLog(path.join(acceptanceDir, REVIEWS_FILE))?.events ?? [];
  const events = mergeLocalReviewEvents(current, incoming.events);
  const added = events.length - current.length;
  if (added > 0) writeReviewLog(acceptanceDir, acceptanceId, events);
  return { added, events };
};

export const writeReviewLog = (
  acceptanceDir: string,
  acceptanceId: string,
  events: LocalReviewEvent[],
) => {
  const log: LocalReviewLog = { acceptanceId, events, format: LOCAL_ACCEPTANCE_FORMAT };
  writeFileSync(path.join(acceptanceDir, REVIEWS_FILE), `${JSON.stringify(log, null, 2)}\n`);
};

export interface LocalAcceptanceRead {
  acceptanceDir: string;
  info: LocalAcceptanceInfo;
  /** A requirement passed now that differs from the one recorded first. */
  keptRequirement?: string;
  /** The saved review log read in this call, with how many decisions were new. */
  reviewsImported?: { added: number; file: string };
  rounds: LocalRoundRead[];
  source: LocalAcceptanceSource;
}

/**
 * Read a local acceptance — every round, plus the reviewer's decisions —
 * into the source its page renders from. `target` is the acceptance directory
 * or any of its round directories.
 */
export function loadLocalAcceptance(
  target: string,
  options: {
    /** Create `acceptance.json` when missing (render does; read-only commands do not). */
    create?: boolean;
    requirement?: string;
    /** A review log to read instead of looking in the downloads folder. */
    reviewsFile?: string;
    /** Warn about authoring gaps of the newest round. */
    warnLatest?: boolean;
  } = {},
): LocalAcceptanceRead {
  const acceptanceDir = resolveAcceptanceDir(target);
  if (!acceptanceDir) throw new Error(`${target} is not a local acceptance or round directory`);

  let info: LocalAcceptanceInfo;
  let keptRequirement: string | undefined;
  if (options.create) {
    ({ info, keptRequirement } = ensureAcceptanceInfo(acceptanceDir, options.requirement));
  } else {
    const existing = readAcceptanceInfo(acceptanceDir);
    if (!existing)
      throw new Error(
        `${acceptanceDir} has no acceptance.json yet — render it first with \`lh acceptance run render\``,
      );
    info = existing;
  }

  const dirs = listRoundDirs(acceptanceDir);
  const rounds = dirs.map((dir, index) =>
    readLocalRound({
      acceptanceDir,
      acceptanceId: info.id,
      dir,
      roundIndex: index + 1,
      warn: options.warnLatest && index === dirs.length - 1,
    }),
  );

  const savedLog = options.reviewsFile ?? findSavedReviewLog(info.id);
  let reviewsImported: LocalAcceptanceRead['reviewsImported'];
  let events = readReviewLog(path.join(acceptanceDir, REVIEWS_FILE))?.events ?? [];
  if (savedLog && existsSync(savedLog)) {
    const imported = importReviewLog(acceptanceDir, info.id, savedLog);
    events = imported.events;
    reviewsImported = { added: imported.added, file: savedLog };
  } else if (options.reviewsFile) {
    throw new Error(`${options.reviewsFile} does not exist`);
  }

  return {
    acceptanceDir,
    info,
    keptRequirement,
    reviewsImported,
    rounds,
    source: {
      acceptance: info,
      acceptanceDir: commandAcceptanceDir(acceptanceDir),
      format: LOCAL_ACCEPTANCE_FORMAT,
      generatedAt: new Date().toISOString(),
      reviews: events,
      rounds: rounds.map((round) => round.source),
    },
  };
}
