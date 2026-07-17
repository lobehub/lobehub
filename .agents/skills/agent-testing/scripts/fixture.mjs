#!/usr/bin/env node
/**
 * fixture.mjs — reusable per-check fixture assets for agent-testing.
 *
 * Fixtures are the durable half of a verification: for each CHECK ITEM (the
 * business check that recurs across acceptance rounds) we keep one directory
 * holding its plan fragment, case template, seed inputs, and (optionally)
 * replayable steps. Rounds are then COMPOSED from checks instead of hand-writing
 * a fresh result.json every time.
 *
 * INPUTS vs OUTPUTS — only inputs are reusable. `seed/` holds what a run
 * CONSUMES (files to upload, DB seed fragments, config, stand-in evidence for
 * synthetic ingest rounds). What a run PRODUCES (screenshots, transcripts) is
 * tied to that one execution and lives only in the round dir's assets/ under
 * .records/reports/ — never copy it back into the fixture.
 *
 * Layout (gitignored, like all .records/ output):
 *   .records/fixtures/<subject-key>/<check-id>/
 *   ├── check.json     # plan fragment + case template (+ steps for future replay)
 *   └── seed/          # reusable INPUT assets referenced by check.json / steps
 *
 * <subject-key> = task-<id> | topic-<id> | document-<id> (subject with ':'→'-'),
 * matching the report group dirs under .records/reports/.
 *
 * Usage:
 *   fixture.mjs init-check --subject topic:tpc_xxx <check-id>
 *       Scaffold .records/fixtures/topic-tpc_xxx/<check-id>/{check.json,seed/}
 *
 *   fixture.mjs compose --subject topic:tpc_xxx --slug <slug> [--title "..."]
 *                       [--focus "..."] [--entry "..."] <check-id> [<check-id>...]
 *       Assemble a report-shaped round dir from the given checks:
 *       .records/reports/topic-tpc_xxx/<ts>-<slug>/  (ready for
 *       `lh verify ingest-report <dir>`). Files referenced by case.evidence
 *       (seed/…) are copied into the round's assets/<check-id>/ and paths
 *       rewritten. Prints the dir path.
 *
 *   fixture.mjs list --subject topic:tpc_xxx
 *       List the subject's check fixtures.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Anchor to the checkout being TESTED (cwd's git toplevel — correct when the
// main checkout's script is invoked inside a worktree), not the script's own
// checkout; fall back to script-relative outside any repo.
const repoRoot = () => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  }
};
const REPO_ROOT = repoRoot();

const fail = (msg) => {
  console.error(`fixture.mjs: ${msg}`);
  process.exit(1);
};

const parseArgs = (argv) => {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      opts[arg.slice(2)] = argv[++i];
    } else {
      positional.push(arg);
    }
  }
  return { opts, positional };
};

const subjectKey = (subject) => {
  if (!/^(?:task|topic|document):.+$/.test(subject || '')) {
    fail(`--subject must be task:<id> | topic:<id> | document:<id>, got '${subject}'`);
  }
  return subject.replace(':', '-');
};

const [command, ...rest] = process.argv.slice(2);
const { opts, positional } = parseArgs(rest);

if (command === 'init-check') {
  const key = subjectKey(opts.subject);
  const checkId = positional[0] || fail('init-check needs a <check-id>');
  const dir = join(REPO_ROOT, '.records/fixtures', key, checkId);
  if (existsSync(join(dir, 'check.json'))) fail(`${dir}/check.json already exists`);
  mkdirSync(join(dir, 'seed'), { recursive: true });
  const template = {
    id: checkId,
    category: '',
    title: '',
    verifier: 'agent',
    method: '',
    expected: '',
    requiredEvidence: [],
    // Case template used by `compose`: the default verdict + observation this
    // fixture reproduces. Evidence paths point at reusable INPUTS under seed/
    // (relative to this check dir) — real execution outputs stay in the round.
    case: { result: 'passed', observation: '', evidence: [] },
    // Reserved for the JSON-replay runner: deterministic steps that set up and
    // verify this check without an agent improvising them each round.
    steps: [],
    notes: '',
  };
  writeFileSync(join(dir, 'check.json'), JSON.stringify(template, null, 2) + '\n');
  console.log(dir);
} else if (command === 'list') {
  const key = subjectKey(opts.subject);
  const root = join(REPO_ROOT, '.records/fixtures', key);
  if (!existsSync(root)) fail(`no fixtures under ${root}`);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const checkFile = join(root, entry.name, 'check.json');
    if (!existsSync(checkFile)) continue;
    const check = JSON.parse(readFileSync(checkFile, 'utf8'));
    console.log(`${entry.name}\t[${check.category}] ${check.title} → ${check.case?.result}`);
  }
} else if (command === 'compose') {
  const key = subjectKey(opts.subject);
  const slug = opts.slug || fail('compose needs --slug');
  if (positional.length === 0) fail('compose needs at least one <check-id>');

  const fixturesRoot = join(REPO_ROOT, '.records/fixtures', key);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const dir = join(REPO_ROOT, '.records/reports', key, `${ts}-${slug}`);
  mkdirSync(join(dir, 'assets'), { recursive: true });

  const plan = [];
  const cases = [];
  for (const checkId of positional) {
    const checkDir = join(fixturesRoot, checkId);
    const checkFile = join(checkDir, 'check.json');
    if (!existsSync(checkFile)) fail(`missing ${checkFile} (run init-check first)`);
    const check = JSON.parse(readFileSync(checkFile, 'utf8'));

    plan.push({
      id: check.id,
      category: check.category,
      title: check.title,
      verifier: check.verifier || 'agent',
      method: check.method,
      expected: check.expected,
      ...(check.requiredEvidence?.length ? { requiredEvidence: check.requiredEvidence } : {}),
    });

    const evidenceList = [check.case?.evidence ?? []].flat();
    const evidence = evidenceList.map((entry) => {
      const src = typeof entry === 'string' ? entry : entry.path;
      const target = join('assets', check.id, basename(src));
      mkdirSync(join(dir, 'assets', check.id), { recursive: true });
      cpSync(join(checkDir, src), join(dir, target));
      return typeof entry === 'string' ? target : { ...entry, path: target };
    });

    cases.push({
      id: check.id,
      name: check.title,
      result: check.case?.result ?? 'passed',
      observation: check.case?.observation ?? '',
      ...(evidence.length ? { evidence: evidence.length === 1 ? evidence[0] : evidence } : {}),
    });
  }

  const passed = cases.filter((c) => c.result === 'passed').length;
  const failed = cases.filter((c) => c.result === 'failed').length;
  const blocked = cases.filter((c) => c.result === 'blocked').length;
  const result = {
    title: opts.title || slug,
    scenario: 'coding',
    subject: opts.subject,
    context: {
      focus: opts.focus || '',
      entry: opts.entry || '',
      branch: '',
      commit: '',
    },
    surfaces: ['web'],
    plan,
    cases,
    summary: {
      total: cases.length,
      passed,
      failed,
      blocked,
      verdict: failed > 0 ? 'fail' : 'pass',
      conclusion: opts.conclusion || `${passed}/${cases.length} 通过`,
    },
  };
  writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(dir, 'report.md'), `${opts.title || slug}\n`);
  console.log(dir);
} else {
  fail(`unknown command '${command}' (init-check | compose | list)`);
}
