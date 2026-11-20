/**
 * Pull the owner's review feedback in a window, grouped by acceptance — the raw material for
 * new rules (see references/calibration.md, "Collect the standard").
 *
 *   bun .agents/skills/alint-ruleset/scripts/collect-rejections.ts [--days 7] [--out <dir>] [--actionable]
 *
 * Wraps `lh acceptance list --json` + `lh acceptance feedback <id> --json`.
 *
 * Known cap: `lh acceptance list` returns a server-side-capped window (the CLI exposes no
 * `--limit`), so a window wider than that cap silently loses the oldest acceptances. The script
 * warns when it hits the cap; widen the window only after confirming the list is complete.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Feedback entry as `lh acceptance feedback --json` emits it (subset we read). */
interface FeedbackEntry {
  actionable?: boolean;
  /** Region notes; the actionable text often lives here, not in `comment`. */
  annotations?: { comment?: string }[];
  checkSeq?: number;
  comment: string;
  createdAt?: string;
  kind?: string;
  roundIndex?: number;
  title?: string;
}

interface AcceptanceRow {
  createdAt?: string;
  id: string;
  requirement?: string | null;
  status?: string;
  subjectId?: string;
  subjectType?: string;
}

const parseArgs = (argv: string[]) => {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      flags.set(key!, inline ?? argv[++index] ?? '');
    }
  }
  return flags;
};

const lh = (args: string[]): unknown => JSON.parse(execFileSync('lh', args, { encoding: 'utf8' }));

const flags = parseArgs(process.argv.slice(2));
const days = Number(flags.get('days') ?? 7);
const actionableOnly = flags.has('actionable');
const outDir = path.resolve(flags.get('out') ?? '/tmp/alint-rejections');
const since = new Date(Date.now() - days * 86_400_000);

let list: AcceptanceRow[];
try {
  list = lh(['acceptance', 'list', '--json']) as AcceptanceRow[];
} catch {
  console.error('`lh acceptance list` failed. Run `lh whoami` to check authentication.');
  process.exit(2);
}

/** Anything without a usable createdAt is kept: better to over-read than to drop a rejection. */
const inWindow = list.filter((row) => !row.createdAt || new Date(row.createdAt) >= since);

/** `lh acceptance feedback --json` → `{ acceptanceId, currentRoundIndex, entries }`. */
const feedbackEntries = (value: unknown): FeedbackEntry[] => {
  if (Array.isArray(value)) return value as FeedbackEntry[];
  const entries = (value as { entries?: unknown }).entries;
  return Array.isArray(entries) ? (entries as FeedbackEntry[]) : [];
};

/** A region note may be the only text; fall back to it when `comment` is empty. */
const textOf = (entry: FeedbackEntry) =>
  [entry.comment, ...(entry.annotations ?? []).map((annotation) => annotation.comment ?? '')]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' · ');

const groups: { acceptance: AcceptanceRow; feedback: FeedbackEntry[] }[] = [];
let total = 0;
for (const acceptance of inWindow) {
  let feedback: FeedbackEntry[];
  try {
    feedback = feedbackEntries(
      lh([
        'acceptance', 'feedback', acceptance.id, '--json',
        ...(actionableOnly ? ['--actionable'] : []),
      ]),
    );
  } catch (error) {
    console.warn(`  ! ${acceptance.id}: ${String(error)}`);
    continue;
  }
  const kept = feedback.filter((entry) => textOf(entry));
  if (kept.length === 0) continue;
  total += kept.length;
  groups.push({ acceptance, feedback: kept });
}

groups.sort((a, b) => (b.acceptance.createdAt ?? '').localeCompare(a.acceptance.createdAt ?? ''));

await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, 'rejections.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), since: since.toISOString(), groups }, null, 2) + '\n',
);

const lines: string[] = [
  `# Review feedback — last ${days} day(s) (since ${since.toISOString().slice(0, 10)})`,
  '',
  `${groups.length} acceptances with feedback · ${total} comments`,
  '',
  '> Read every comment. Keep the ones that (a) recur and (b) can be decided from one file —',
  '> those become rules, quoting the comment verbatim. Requirements, taste calls and',
  '> AST/path decisions are not rules.',
  '',
];
for (const { acceptance, feedback } of groups) {
  const requirement = (acceptance.requirement ?? '').replaceAll('\n', ' ').slice(0, 100);
  lines.push(
    `## ${acceptance.subjectType ?? '?'} · ${acceptance.id} — ${acceptance.status ?? '?'}`,
    '',
    requirement ? `> ${requirement}` : '',
    '',
  );
  for (const entry of feedback) {
    const where = [entry.kind, entry.checkSeq !== undefined ? `C${entry.checkSeq}` : '', entry.title]
      .filter(Boolean)
      .join(' ');
    const flag = entry.actionable ? '▶ ' : '';
    lines.push(`- ${flag}${where ? `**${where}** ` : ''}${textOf(entry).replaceAll('\n', ' ')}`);
  }
  lines.push('');
}
await writeFile(path.join(outDir, 'rejections.md'), lines.join('\n') + '\n');

console.info(lines.slice(0, 8).join('\n'));
console.info(`\nrejections.json · rejections.md → ${outDir}`);
if (list.length >= 50) {
  console.warn(
    `\n! list returned ${list.length} rows — this may be the CLI cap. The window may be truncated; narrow --days or paginate the API.`,
  );
}
