#!/usr/bin/env node
/**
 * Decides which Test CI / E2E CI jobs a run needs, and whether the unit tests
 * run in full or only for what the pull request changed ("affected" mode).
 *
 * Pushes, manual runs, `release/*` and `hotfix/*` branches, pull requests with
 * the `trigger:full-ci` label, and changes that can move every test (dependencies,
 * test or build config, the CI workflows themselves, deleted or renamed source
 * files, non-code assets read at runtime) all run in full. Otherwise each job
 * runs only when its area changed, and the vitest shards narrow further with
 * `--changed` to the tests that import a changed file.
 *
 * Node builtins only: runs before dependencies are installed.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FULL_LABEL = 'trigger:full-ci';
/** Beyond this many changed files, selecting tests is not worth the risk. */
export const MAX_AFFECTED_FILES = 300;
/** Has its own job (Test Database) with a real Postgres. */
const DATABASE_PACKAGE = '@lobechat/database';
/**
 * Packages with a `test` script that Test Packages leaves out, and why. Before
 * the package list was derived from the workspace these never ran in CI; the
 * rest of that backlog passes and runs now.
 */
export const EXCLUDED_TEST_PACKAGES = {
  '@lobechat/builtin-tool-agent-management':
    'resolveManifest.test.ts expects a callAgent param list the manifest no longer has',
  '@lobechat/canvas': 'validateCanvasProject.test.ts expects a Mermaid error one line lower',
  '@lobechat/style-equivalence': 'its server tests need Playwright browsers and stored builds',
};

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const CODE_FILE = /\.([cm]?[jt]sx?|json|mdx?|css|less|scss)$/;
const STATIC_ASSET = /\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp3|mp4|webm|wav)$/;

/** Changes that can move any test or build: always the full run. */
const FULL_RUN_TRIGGERS = [
  /(^|\/)package\.json$/,
  /^pnpm-workspace\.yaml$/,
  /^\.npmrc$/,
  /^\.nvmrc$/,
  /^patches\//,
  /^tsconfig[^/]*\.json$/,
  /^vitest\.config[^/]*$/,
  /^vite\.config[^/]*$/,
  /^plugins\//,
  /^__mocks__\//,
  /^tests\/setup[^/]*$/,
  /(^|\/)(__snapshots__|__fixtures__|fixtures)\//,
  /^\.github\/workflows\/(test|e2e)\.yml$/,
  /^\.github\/actions\//,
  /^\.github\/scripts\/ci-scope/,
];

/** Source roots whose deletions or renames can leave a stale importer behind. */
const SOURCE_ROOT = /^(src|apps\/(server|share|workbench|auth)|packages|tests|scripts)\//;

const FLAGS = ['app', 'server', 'packages', 'database', 'windowsShell', 'e2e', 'renderBudget'];

const full = (reason) => ({
  mode: 'full',
  reason,
  ...Object.fromEntries(FLAGS.map((flag) => [flag, true])),
  packageNames: null,
});

/**
 * @param {object} input
 * @param {string} input.eventName  GitHub event that started the run
 * @param {string} [input.headRef]  pull request head branch
 * @param {string[]} [input.labels] pull request labels
 * @param {{status: string, path: string, from?: string}[] | null} input.changes  changed files
 *   (git `--name-status` letters), or null when they could not be listed
 * @param {Map<string, {dir: string, deps: string[], hasTest: boolean, hasCoverage?: boolean}>} [input.workspace]
 *   workspace packages under `packages/`, keyed by name
 */
export function computeScope({ eventName, headRef = '', labels = [], changes, workspace }) {
  if (eventName !== 'pull_request') return full(`${eventName} runs the full suite`);
  if (labels.includes(FULL_LABEL)) return full(`the "${FULL_LABEL}" label is set`);
  if (/^(release|hotfix)\//.test(headRef)) return full(`${headRef} is a release branch`);
  if (!changes) return full('the changed files could not be listed');
  if (changes.length > MAX_AFFECTED_FILES)
    return full(`${changes.length} changed files (over ${MAX_AFFECTED_FILES})`);

  for (const { status, path: file, from } of changes) {
    const trigger = FULL_RUN_TRIGGERS.find(
      (pattern) => pattern.test(file) || pattern.test(from ?? ''),
    );
    if (trigger) return full(`${file} can affect every test`);
    if (/^[DR]/.test(status) && (SOURCE_ROOT.test(file) || SOURCE_ROOT.test(from ?? ''))) {
      return full(`${from ?? file} was ${status.startsWith('D') ? 'deleted' : 'renamed'}`);
    }
    if (
      (SOURCE_ROOT.test(file) || file.startsWith('apps/cli/')) &&
      !CODE_FILE.test(file) &&
      !STATIC_ASSET.test(file) &&
      // A package's own data files only matter to its tests, which Test
      // Packages runs whole. Database migrations are applied by the server
      // tests too (PGlite), so they stay a full run.
      !(file.startsWith('packages/') && !file.startsWith('packages/database/'))
    ) {
      // Templates, SQL migrations, YAML and the like are read from disk, which
      // no import graph sees.
      return full(`${file} is read at runtime outside the import graph`);
    }
  }

  const scope = Object.fromEntries(FLAGS.map((flag) => [flag, false]));
  const changedPackages = new Set();
  const ownerOf = packageOwner(workspace);

  for (const { path: file } of changes) {
    const isTest = TEST_FILE.test(file);
    const isAsset = STATIC_ASSET.test(file);

    // Test Database runs for any app, server or package source change: its
    // config aliases `@/` to src/ and `@/server/*` to apps/server/src, so DB
    // tests import code outside the package (KeyVaultsEncrypt, file service, …).
    // In affected mode it narrows with `--changed` like the other shards.
    if (file.startsWith('src/')) {
      scope.app = true;
      if (!isTest)
        Object.assign(scope, { database: true, e2e: true, renderBudget: true, server: true });
    } else if (file.startsWith('apps/server/')) {
      scope.server = true;
      // a few app tests import server modules
      if (!isTest) Object.assign(scope, { app: true, database: true, e2e: true });
    } else if (/^apps\/(share|workbench|auth)\//.test(file)) {
      scope.app = true;
      if (!isTest) scope.e2e = true;
    } else if (file.startsWith('packages/')) {
      const owner = ownerOf(file);
      if (owner) changedPackages.add(owner);
      if (file.startsWith('packages/database/')) scope.database = true;
      if (file.startsWith('packages/local-file-shell/')) scope.windowsShell = true;
      const isData = !CODE_FILE.test(file) && !isAsset;
      if (isData) {
        scope.e2e = true;
      } else if (!isTest && !isAsset) {
        // the app, the server and the database layer all import packages
        Object.assign(scope, { app: true, database: true, e2e: true, server: true });
        if (file.endsWith('.tsx')) scope.renderBudget = true;
      } else if (isAsset) {
        Object.assign(scope, { e2e: true, renderBudget: true });
      }
    } else if (file.startsWith('tests/')) {
      Object.assign(scope, { app: true, server: true });
    } else if (file.startsWith('scripts/')) {
      // app-project tests cover scripts/, and the build runs them
      Object.assign(scope, { app: true, e2e: true });
    } else if (file.startsWith('apps/cli/') || file.startsWith('.github/scripts/')) {
      scope.packages = true;
    } else if (file.startsWith('e2e/')) {
      Object.assign(scope, { e2e: true, renderBudget: true });
    } else if (file.startsWith('locales/')) {
      Object.assign(scope, { app: true, e2e: true });
    } else if (
      file.startsWith('public/') ||
      /^index[^/]*\.html$/.test(file) ||
      /^next\.config\.[cm]?ts$/.test(file)
    ) {
      Object.assign(scope, { e2e: true, renderBudget: true });
    }
    // Anything else (docs, apps/desktop, apps/mobile, other workflows, agent
    // config, root tooling) needs no unit-test or E2E job: Lint and the
    // desktop job always run.
  }

  const packageNames = workspace ? affectedTestPackages(workspace, changedPackages) : null;
  if (packageNames === null) {
    if (changedPackages.size > 0) scope.packages = true;
  } else if (packageNames.length > 0) {
    scope.packages = true;
  }

  return {
    mode: 'affected',
    reason: 'only the changed areas and the tests that import a changed file',
    ...scope,
    packageNames,
  };
}

function packageOwner(workspace) {
  const dirs = workspace
    ? [...workspace].map(([name, { dir }]) => [dir.endsWith('/') ? dir : `${dir}/`, name])
    : [];
  dirs.sort((a, b) => b[0].length - a[0].length);
  return (file) => dirs.find(([dir]) => file.startsWith(dir))?.[1];
}

/** Changed packages plus every package that depends on one, that have a `test` script. */
export function affectedTestPackages(workspace, changed) {
  const dependents = new Map();
  for (const [name, { deps }] of workspace) {
    for (const dep of deps) {
      if (!workspace.has(dep)) continue;
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep).add(name);
    }
  }
  const selected = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    for (const next of dependents.get(queue.pop()) ?? []) {
      if (!selected.has(next)) {
        selected.add(next);
        queue.push(next);
      }
    }
  }
  return testPackages(workspace).filter((name) => selected.has(name));
}

/** Every workspace package under `packages/` that has tests to run in Test Packages. */
export function testPackages(workspace) {
  return [...workspace]
    .filter(
      ([name, { hasTest }]) =>
        hasTest && name !== DATABASE_PACKAGE && !Object.hasOwn(EXCLUDED_TEST_PACKAGES, name),
    )
    .map(([name]) => name)
    .sort();
}

// Reads the manifests one and two levels under packages/, as pnpm-workspace.yaml allows.
export function readWorkspace(root) {
  const workspace = new Map();
  const visit = (dir, depth) => {
    const manifest = path.join(root, dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.name) {
        workspace.set(pkg.name, {
          dir,
          deps: Object.keys({
            ...pkg.dependencies,
            ...pkg.devDependencies,
            ...pkg.peerDependencies,
            ...pkg.optionalDependencies,
          }),
          hasCoverage: Boolean(pkg.scripts?.['test:coverage']),
          hasTest: Boolean(pkg.scripts?.test),
        });
      }
    }
    if (depth === 0) return;
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (entry.isDirectory() && !['node_modules', 'src', 'dist'].includes(entry.name)) {
        visit(path.posix.join(dir, entry.name), depth - 1);
      }
    }
  };
  for (const entry of readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
    if (entry.isDirectory()) visit(`packages/${entry.name}`, 1);
  }
  return workspace;
}

/** Parses `git diff --name-status -M` output. */
export function parseNameStatus(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, first, second] = line.split('\t');
      return second ? { status, from: first, path: second } : { status, path: first };
    });
}

async function fetchLabels({ repository, prNumber, token }) {
  if (!prNumber || !token) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repository}/pulls/${prNumber}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()).labels.map((label) => label.name);
  } catch {
    return null;
  }
}

async function main() {
  const env = process.env;
  const root = process.cwd();
  const eventName = env.GITHUB_EVENT_NAME ?? 'local';

  // Labels are read live so that adding `trigger:full-ci` and re-running the workflow
  // takes effect; the event payload only has the labels from when it fired.
  const payloadLabels = JSON.parse(env.PR_LABELS || 'null') ?? [];
  const liveLabels = await fetchLabels({
    prNumber: env.PR_NUMBER,
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN,
  });

  let changes = null;
  if (eventName === 'pull_request') {
    try {
      // The checkout is the PR merge commit: its first parent is the base tip.
      changes = parseNameStatus(
        execFileSync('git', ['diff', '--name-status', '-M', 'HEAD^1', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }),
      );
    } catch (error) {
      console.log(`::warning::could not list the changed files: ${error.message}`);
    }
  }

  const workspace = readWorkspace(root);
  const scope = computeScope({
    changes,
    eventName,
    headRef: env.HEAD_REF ?? '',
    labels: liveLabels ?? payloadLabels,
    workspace,
  });
  const packageNames = scope.packageNames ?? testPackages(workspace);
  // Full runs collect coverage where a package has a `test:coverage` script.
  const withCoverage = (name) => scope.mode === 'full' && workspace.get(name)?.hasCoverage;

  const outputs = {
    mode: scope.mode,
    reason: scope.reason,
    app: scope.app,
    server: scope.server,
    packages: scope.packages,
    database: scope.database,
    windows_shell: scope.windowsShell,
    e2e: scope.e2e,
    render_budget: scope.renderBudget,
    coverage_packages: packageNames.filter(withCoverage).join(' '),
    plain_packages: packageNames.filter((name) => !withCoverage(name)).join(' '),
  };

  const summary = [
    `### CI scope: ${scope.mode}`,
    '',
    scope.reason,
    '',
    '| Job | Runs |',
    '| --- | --- |',
    ...Object.entries(outputs)
      .filter(([, value]) => typeof value === 'boolean')
      .map(([key, value]) => `| ${key} | ${value ? 'yes' : 'skipped'} |`),
    '',
    scope.mode === 'affected' && packageNames.length > 0
      ? `Packages: ${packageNames.join(', ')}`
      : '',
    changes ? `${changes.length} changed files.` : '',
    `Add the \`${FULL_LABEL}\` label and re-run to force the full suite.`,
  ].join('\n');

  console.log(summary);
  if (env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
