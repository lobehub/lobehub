/**
 * Gather the ALint signal from real PRs in a window: the `ALint` check runs, their line
 * annotations, and each run's summary (which carries the PR-comment table and the usage line).
 * Deduplicated on PR + rule + file + message.
 *
 *   bun .agents/skills/alint-ruleset/scripts/pull-alint-runs.ts [--days 7] [--out <dir>] [--repo owner/name] [--max-prs 200]
 *
 * This script only gathers and tallies — it never judges TP/FP. Read the worksheet against the
 * source yourself (see references/promotion.md).
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface CheckRun {
  conclusion: string | null;
  id: number;
  name: string;
  output?: { summary?: string | null; title?: string | null };
  started_at: string;
}

interface Annotation {
  annotation_level: string;
  message: string;
  path: string;
  start_line: number;
  title: string;
}

interface PullRequest {
  baseRefName: string;
  headRefOid: string;
  number: number;
  state: string;
  title: string;
  updatedAt: string;
  url: string;
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

const gh = (args: string[]): unknown =>
  JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));

const ghText = (args: string[]): string => execFileSync('gh', args, { encoding: 'utf8' }).trim();

const flags = parseArgs(process.argv.slice(2));
const days = Number(flags.get('days') ?? 7);
const maxPrs = Number(flags.get('max-prs') ?? 200);
const outDir = path.resolve(flags.get('out') ?? '/tmp/alint-ci');
const since = new Date(Date.now() - days * 86_400_000);

let repo: string;
try {
  repo = flags.get('repo') ?? ghText(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
} catch {
  console.error('gh could not resolve the repository. Run `gh auth status` and `gh repo set-default`.');
  process.exit(2);
}

const pulls = gh([
  'pr', 'list', '--state', 'all', '--limit', String(maxPrs),
  '--json', 'number,headRefOid,baseRefName,updatedAt,title,url,state',
]) as PullRequest[];

const window = pulls
  .filter((pull) => new Date(pull.updatedAt) >= since)
  .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

interface WorksheetEntry {
  baseRefName: string;
  conclusion: string | null;
  level: string;
  line: number;
  message: string;
  path: string;
  pr: number;
  rule: string;
  title: string;
  url: string;
}

const runs: {
  annotations: number;
  conclusion: string | null;
  pr: number;
  sha: string;
  summary: string;
  title: string | null;
  url: string;
}[] = [];
const findings = new Map<string, WorksheetEntry>();

for (const pull of window) {
  let checkRuns: CheckRun[];
  try {
    checkRuns = (gh(['api', `repos/${repo}/commits/${pull.headRefOid}/check-runs?per_page=100`]) as {
      check_runs: CheckRun[];
    }).check_runs;
  } catch {
    continue;
  }

  const alintRuns = checkRuns
    .filter((run) => run.name === 'ALint')
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const latest = alintRuns.at(-1);
  if (!latest) continue;

  let annotations: Annotation[];
  try {
    annotations = gh(['api', `repos/${repo}/check-runs/${latest.id}/annotations?per_page=100`]) as Annotation[];
  } catch {
    annotations = [];
  }

  runs.push({
    annotations: annotations.length,
    conclusion: latest.conclusion,
    pr: pull.number,
    sha: pull.headRefOid,
    summary: latest.output?.summary ?? '',
    title: latest.output?.title ?? null,
    url: pull.url,
  });

  for (const annotation of annotations) {
    const rule = annotation.title ?? '(unknown)';
    const message = (annotation.message ?? '').split('\n')[0]!.trim();
    const key = `${pull.number}|${rule}|${annotation.path}|${message}`;
    // The latest run of a PR is the last word: a finding absent from it was fixed or explained.
    findings.set(key, {
      baseRefName: pull.baseRefName,
      conclusion: latest.conclusion,
      level: annotation.annotation_level,
      line: annotation.start_line,
      message,
      path: annotation.path,
      pr: pull.number,
      rule,
      title: pull.title,
      url: pull.url,
    });
  }
}

const entries = [...findings.values()];
const byRule = new Map<string, WorksheetEntry[]>();
for (const entry of entries) {
  const list = byRule.get(entry.rule) ?? [];
  list.push(entry);
  byRule.set(entry.rule, list);
}

await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, 'worksheet.json'),
  JSON.stringify(
    { generatedAt: new Date().toISOString(), repo, runs, since: since.toISOString(), window: { days, prs: window.length } },
    null,
    2,
  ) + '\n',
);
await writeFile(path.join(outDir, 'findings.json'), JSON.stringify(entries, null, 2) + '\n');

const table: string[] = [
  `# ALint findings on real PRs — last ${days} day(s) (since ${since.toISOString().slice(0, 10)})`,
  '',
  `${window.length} PRs updated in the window · ${runs.length} with an ALint run · ${entries.length} standing findings (deduped).`,
  '',
  '| rule | standing findings | PRs | base `main`? |',
  '| --- | ---: | ---: | ---: |',
];
for (const [rule, list] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
  const pullCount = new Set(list.map((entry) => entry.pr)).size;
  const release = list.filter((entry) => entry.baseRefName === 'main').length;
  table.push(`| \`${rule}\` | ${list.length} | ${pullCount} | ${release} |`);
}
if (entries.length === 0) table.push('| _(none)_ | 0 | 0 | 0 |');
table.push(
  '',
  "> Findings are deduped on PR + rule + file + message and kept only when present in the PR's **latest** run.",
  '> Annotations are capped at 50 per run, so a rule with more is under-counted here; the run summary has the full table.',
  '> Read each row against the source and mark TP / FP / borderline before promoting anything.',
);
await writeFile(path.join(outDir, 'by-rule.md'), table.join('\n') + '\n');

console.info(table.join('\n'));
console.info(`\nworksheet.json · findings.json · by-rule.md → ${outDir}`);
