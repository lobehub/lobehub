import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { readReviews, reviewScope, writeReviews } from '../review/store';
import { decideVerdict, signCases, type VerdictItem } from '../verdict';

const run = promisify(execFile);

export interface StoredRun {
  calibration: Array<{ status: string }>;
  evidence: Record<string, unknown>;
  extractions: Record<string, unknown>;
  items: VerdictItem[];
  mutation: { passed: boolean };
  plans?: Array<{ file: string; standIns?: Record<string, string[]> }>;
  recordsDir: string;
  results: { cases: Array<{ category: string; key: string; plan: { file: string } }> };
  run: Record<string, unknown> & { repo?: string };
}

const readJson = async <T>(runDir: string, name: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(path.join(runDir, name), 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
};

export const loadRun = async (runDir: string): Promise<StoredRun> => {
  const verdict = await readJson<{ items: Array<VerdictItem & { signoff?: string }> }>(
    runDir,
    'verdict.json',
    { items: [] },
  );
  return {
    calibration: await readJson(runDir, 'calibration.json', []),
    evidence: await readJson(runDir, 'evidence.json', {}),
    extractions: await readJson(runDir, 'extractions.json', {}),
    items: verdict.items.map(({ signoff: _signoff, ...item }) => item),
    mutation: await readJson(runDir, 'mutation.json', { passed: false }),
    plans: await readJson(runDir, 'plan.json', []),
    recordsDir: path.dirname(runDir),
    results: await readJson(runDir, 'results.json', { cases: [] }),
    run: await readJson(runDir, 'run.json', {}),
  };
};

export const readSelfTest = async (file: string) =>
  readJson<unknown>(path.dirname(file), path.basename(file), null);

export const runPr = (stored: StoredRun) =>
  (stored.run.pr as { number?: number } | undefined)?.number;

export const readRunReviews = (stored: StoredRun) =>
  readReviews(
    stored.recordsDir,
    stored.items.map((item) => item.file),
    reviewScope(stored.items, runPr(stored)),
  );

export const currentVerdict = async (stored: StoredRun) => {
  const reviews = await readRunReviews(stored);
  return decideVerdict({
    calibration: stored.calibration,
    items: stored.items,
    mutation: stored.mutation,
    reworks: reviews.reworks,
    signoffs: reviews.passes,
    unparsedSelectors: (stored.run.unparsedSelectors as string[] | undefined)?.length,
  });
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const caseDetail = async (stored: StoredRun, key: string) => {
  const record = stored.results.cases.find((entry) => entry.key === key);
  const verdict = await currentVerdict(stored);
  const item = verdict.items.find((entry) => entry.key === key);
  if (!record && !item) throw new ApiError(404, `UNKNOWN_CASE:${key}`);
  const file = record?.plan.file ?? item?.file;
  return {
    case: record,
    evidence: stored.evidence[key],
    extraction: file ? stored.extractions[file] : undefined,
    item,
  };
};

export const defaultSigner = async (repo: string) => {
  try {
    return (await run('git', ['-C', repo, 'config', 'user.name'])).stdout.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
};

export const applySignoff = async (
  stored: StoredRun,
  body: { keys?: unknown; note?: unknown; reason?: unknown; signer?: unknown },
) => {
  const repo = stored.run.repo;
  if (!repo) throw new ApiError(409, 'RUN_HAS_NO_REPOSITORY');
  if (!Array.isArray(body.keys) || typeof body.reason !== 'string' || typeof body.note !== 'string')
    throw new ApiError(400, 'EXPECTED_KEYS_REASON_NOTE');
  let records;
  try {
    records = signCases({
      existing: (await readRunReviews(stored)).passes,
      items: stored.items,
      keys: body.keys.map(String),
      note: body.note,
      now: new Date().toISOString(),
      reason: body.reason,
      signer:
        typeof body.signer === 'string' && body.signer ? body.signer : await defaultSigner(repo),
    });
  } catch (error) {
    throw new ApiError(409, error instanceof Error ? error.message : String(error));
  }
  const byFile = new Map<string, typeof records>();
  for (const record of records) {
    const file = stored.items.find((item) => item.key === record.key)!.file;
    byFile.set(file, [...(byFile.get(file) ?? []), record]);
  }
  for (const [file, list] of byFile) await writeReviews(stored.recordsDir, file, { passes: list });
  return { records, verdict: await currentVerdict(stored) };
};
