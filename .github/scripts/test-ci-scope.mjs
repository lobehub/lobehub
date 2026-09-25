import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Decides which Test CI jobs a pull request actually needs, so a desktop-only
 * or CLI-only change does not hold a dozen runners for suites it cannot affect.
 *
 * The rules only carve out edges whose isolation is structural: `src/`,
 * `apps/server/` and `packages/` import each other through path aliases (trpc,
 * openapi and app-config reach into `@/server` and `@/database`), so any change
 * there runs the whole app/server/packages trio. Unknown paths run everything —
 * a missed skip only costs minutes, a wrong skip hides a regression.
 */

export const SCOPES = ['app', 'server', 'packages', 'desktop', 'windows'];

const CORE = ['app', 'server', 'packages'];

/** First matching rule wins; `null` scopes means the file affects no test job. */
const RULES = [
  // Workflow plumbing shared by every job.
  { scopes: SCOPES, test: (f) => f === '.github/workflows/test.yml' },
  { scopes: SCOPES, test: (f) => f.startsWith('.github/actions/') },
  { scopes: SCOPES, test: (f) => f.startsWith('.github/scripts/test-ci-scope') },
  {
    scopes: ['packages'],
    test: (f) =>
      f.startsWith('.github/scripts/vercel-ignored-build-step') ||
      f.startsWith('scripts/vercelIgnoredBuildStep'),
  },

  // Files no Test CI job reads. Lint configs only feed `bun run lint`, which the
  // database job runs unconditionally.
  { scopes: null, test: (f) => f.endsWith('.md') || f.endsWith('.mdx') },
  { scopes: null, test: (f) => /^(docs|e2e|\.github|\.agents|\.claude|changelog)\//.test(f) },
  {
    scopes: null,
    test: (f) =>
      /^(eslint\.config\.mjs|stylelint\.config\.mjs|\.prettierignore|\.remarkignore)$/.test(f),
  },

  // alint only runs inside the desktop job.
  {
    scopes: ['desktop'],
    test: (f) => f === 'alint.config.toml' || f.startsWith('packages/alint/'),
  },
  // Script and compose tests live in the app project.
  { scopes: ['app'], test: (f) => /^(scripts|docker-compose)\//.test(f) },

  // Leaf apps: nothing else imports them.
  { scopes: ['desktop'], test: (f) => f.startsWith('apps/desktop/') },
  // CLI tests run in the packages job; the app/server projects exclude apps/cli.
  { scopes: ['packages'], test: (f) => f.startsWith('apps/cli/') },
  // Tested by the app project only; apps/server never imports them.
  { scopes: ['app'], test: (f) => /^apps\/(auth|share|workbench)\//.test(f) },

  // The desktop app consumes workspace packages but not `src/` or `apps/server/`.
  {
    scopes: [...CORE, 'desktop', 'windows'],
    test: (f) => f.startsWith('packages/local-file-shell/'),
  },
  { scopes: [...CORE, 'desktop'], test: (f) => f.startsWith('packages/') },
  { scopes: CORE, test: (f) => /^(src|apps\/server|locales|tests|__mocks__)\//.test(f) },
];

/**
 * @param {string[]} files repo-relative paths changed by the pull request
 * @returns {Record<string, boolean>}
 */
export const resolveTestScopes = (files) => {
  const needed = new Set();

  for (const file of files) {
    const rule = RULES.find((r) => r.test(file));
    // Root config, lockfile, patches and anything unclassified run everything.
    const scopes = rule ? rule.scopes : SCOPES;
    for (const scope of scopes ?? []) needed.add(scope);
    if (needed.size === SCOPES.length) break;
  }

  return Object.fromEntries(SCOPES.map((scope) => [scope, needed.has(scope)]));
};

const main = () => {
  const [, , mode] = process.argv;
  const scopes =
    mode === '--all'
      ? Object.fromEntries(SCOPES.map((scope) => [scope, true]))
      : resolveTestScopes(readFileSync(0, 'utf8').split('\n').filter(Boolean));

  const lines = Object.entries(scopes).map(([scope, run]) => `${scope}=${run}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
