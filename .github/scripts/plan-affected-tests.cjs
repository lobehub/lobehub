const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

// Inputs outside the Vite import graph, so `vitest --changed` cannot trace them.
const FULL_RUN_TRIGGERS = [
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^package\.json$/,
  /^\.npmrc$/,
  /^vitest\.config\.[cm]?ts$/,
  /^tsconfig(\..+)?\.json$/,
  /^tests\//,
];

const APP_FILES_PER_SHARD = 500;
const SERVER_FILES_PER_SHARD = 400;

const isFullRunTrigger = (file) => FULL_RUN_TRIGGERS.some((pattern) => pattern.test(file));

const shardsFor = (count, filesPerShard, maxShards) =>
  Array.from({ length: Math.min(maxShards, Math.ceil(count / filesPerShard)) }, (_, i) => i + 1);

const fullPlan = (packages, reason) => ({
  appShards: [1, 2, 3],
  mode: 'full',
  packages,
  reason,
  serverShards: [1, 2],
  windowsShell: true,
});

const exec = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const planAffectedTests = ({ base, packages, run = exec }) => {
  if (!base) return fullPlan(packages, 'no merge base');

  const changed = run('git', ['diff', '--name-only', `${base}...HEAD`])
    .split('\n')
    .filter(Boolean);
  const trigger = changed.find(isFullRunTrigger);
  if (trigger) return fullPlan(packages, `${trigger} changed`);

  const specs = JSON.parse(
    run('node_modules/.bin/vitest', ['list', '--changed', base, '--filesOnly', '--json']),
  );
  const countIn = (project) => specs.filter((spec) => spec.projectName === project).length;

  const affectedPackages = new Set(
    JSON.parse(
      run('pnpm', ['list', '--recursive', '--depth', '-1', '--json', '--filter', `...[${base}]`]),
    ).map((pkg) => pkg.name),
  );

  return {
    appShards: shardsFor(countIn('app'), APP_FILES_PER_SHARD, 3),
    mode: 'affected',
    packages: packages.filter((name) => affectedPackages.has(name)),
    reason: `${changed.length} changed files, ${countIn('app')} app + ${countIn('server')} server test files`,
    serverShards: shardsFor(countIn('server'), SERVER_FILES_PER_SHARD, 2),
    windowsShell: affectedPackages.has('@lobechat/local-file-shell'),
  };
};

if (require.main === module) {
  const plan = planAffectedTests({
    base: process.env.PLAN_BASE,
    packages: (process.env.PACKAGES ?? '').split(/\s+/).filter(Boolean),
  });
  console.log(JSON.stringify(plan, null, 2));

  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `mode=${plan.mode}`,
      `app_shards=${JSON.stringify(plan.appShards)}`,
      `app_total=${plan.appShards.length}`,
      `server_shards=${JSON.stringify(plan.serverShards)}`,
      `server_total=${plan.serverShards.length}`,
      `packages=${plan.packages.join(' ')}`,
      `windows_shell=${plan.windowsShell}`,
      '',
    ].join('\n'),
  );
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Test plan: ${plan.mode}\n\n${plan.reason}\n\n| | |\n|---|---|\n| App shards | ${plan.appShards.length} |\n| Server shards | ${plan.serverShards.length} |\n| Packages | ${plan.packages.length} |\n| Windows shell | ${plan.windowsShell} |\n`,
  );
}

module.exports = { isFullRunTrigger, planAffectedTests, shardsFor };
