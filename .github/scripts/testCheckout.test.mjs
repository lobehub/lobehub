import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';

const exec = promisify(execFile);
const workflows = await Promise.all(
  ['test', 'e2e'].map(async (name) => ({
    name,
    source: await readFile(new URL(`../workflows/${name}.yml`, import.meta.url), 'utf8'),
  })),
);

// These checks run before dependency installation, so use only Node builtins.
function steps(source, name) {
  return source
    .split(`      - name: ${name}\n`)
    .slice(1)
    .map((part) => part.split(/\n(?: {6}- | {2}[\w-]+:)/)[0]);
}

function runBlock(step) {
  const block = step.match(/ {8}run: \|\n((?:          .*\n|\n)*)/);
  assert.ok(block, 'step has a shell script');
  return block[1].replaceAll(/^ {10}/gm, '');
}

function checkoutEnv(step, context) {
  const expressions = {
    'github.sha': context.sha,
    'github.repository': 'fixture/upstream',
    "github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha":
      context.event === 'pull_request' ? context.head : context.sha,
    "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name || github.repository":
      context.event === 'pull_request' ? context.repository : 'fixture/upstream',
  };
  return Object.fromEntries(
    ['REF_SHA', 'REPOSITORY'].map((key) => {
      const expression = step.match(new RegExp(`          ${key}: \\$\\{\\{ (.+) \\}\\}`))?.[1];
      assert.ok(Object.hasOwn(expressions, expression), `known ${key} expression: ${expression}`);
      return [key, expressions[expression]];
    }),
  );
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ci-checkout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const upstream = path.join(root, 'upstream.git');
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'),
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  await writeFile(
    env.GIT_CONFIG_GLOBAL,
    [
      '[commit]',
      '  gpgsign = false',
      '[core]',
      '  hooksPath = /dev/null',
      `[url "file://${root}/"]`,
      '  insteadOf = https://github.com/fixture/',
      '',
    ].join('\n'),
  );
  const git = async (cwd, ...args) => (await exec('git', args, { cwd, env })).stdout.trim();
  await mkdir(upstream);
  await git(upstream, 'init', '-q', '-b', 'canary');
  await writeFile(path.join(upstream, '.gitignore'), 'node_modules/\n');
  await writeFile(path.join(upstream, 'shared.txt'), 'original\n');
  await git(upstream, 'add', '.');
  await git(upstream, 'commit', '-qm', 'common ancestor');
  const base = await git(upstream, 'rev-parse', 'HEAD');
  await git(upstream, 'checkout', '-qb', 'feature');
  await writeFile(path.join(upstream, 'feature.txt'), 'PR change\n');
  await git(upstream, 'add', '.');
  await git(upstream, 'commit', '-qm', 'PR head');
  const head = await git(upstream, 'rev-parse', 'HEAD');
  await git(root, 'clone', '--bare', upstream, path.join(root, 'fork.git'));
  await git(upstream, 'checkout', 'canary');
  await mkdir(path.join(upstream, 'packages/new-package'), { recursive: true });
  await writeFile(
    path.join(upstream, 'packages/new-package/package.json'),
    '{"name":"new-package"}\n',
  );
  await writeFile(path.join(upstream, 'shared.txt'), 'base-only update\n');
  await git(upstream, 'add', '.');
  await git(upstream, 'commit', '-qm', 'base adds a workspace package');
  const push = await git(upstream, 'rev-parse', 'HEAD');
  await git(upstream, 'merge', '--no-ff', '-m', 'PR merge', 'feature');
  const merge = await git(upstream, 'rev-parse', 'HEAD');
  return { base, env, git, head, merge, push, root };
}

const checkouts = workflows.flatMap(({ name, source }) =>
  steps(source, 'Checkout')
    .filter((step) => step.includes('run:'))
    .map((step, index) => ({
      label: `${name} checkout ${index + 1}`,
      step,
    })),
);

for (const scenario of ['same-repository PR', 'fork PR', 'push']) {
  test(`${scenario}: every anonymous checkout uses the workflow revision`, async (t) => {
    const f = await fixture(t);
    const context = {
      event: scenario === 'push' ? 'push' : 'pull_request',
      head: f.head,
      repository: scenario === 'fork PR' ? 'fixture/fork' : 'fixture/upstream',
      sha: scenario === 'push' ? f.push : f.merge,
    };
    for (const { label, step } of checkouts) {
      await t.test(label, async () => {
        const cwd = path.join(f.root, label);
        await mkdir(cwd);
        await exec('bash', ['-e', '-o', 'pipefail', '-c', runBlock(step)], {
          cwd,
          env: { ...f.env, ...checkoutEnv(step, context) },
        });
        assert.equal(await f.git(cwd, 'rev-parse', 'HEAD'), context.sha);
        assert.equal(
          JSON.parse(await readFile(path.join(cwd, 'packages/new-package/package.json'))).name,
          'new-package',
        );
        if (scenario !== 'push') {
          assert.equal(await readFile(path.join(cwd, 'feature.txt'), 'utf8'), 'PR change\n');
        }
        assert.equal(
          await f.git(cwd, 'remote', 'get-url', 'origin'),
          `file://${f.root}/upstream.git`,
        );
        assert.equal(
          (await exec('git', ['config', '--local', '--list'], { cwd, env: f.env })).stdout.includes(
            'extraheader',
          ),
          false,
        );
      });
    }
  });
}

test('ALint restores PR head before exposing only PR changes, retaining installed dependencies', async (t) => {
  const f = await fixture(t);
  const cwd = path.join(f.root, 'alint');
  await f.git(f.root, 'clone', '--depth=1', `file://${f.root}/upstream.git`, cwd);
  const bin = path.join(f.root, 'bin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$FIXTURE_MERGE_BASE"\n', {
    mode: 0o755,
  });
  await mkdir(path.join(cwd, 'node_modules'));
  await writeFile(path.join(cwd, 'node_modules/installed'), 'keep');
  const step = steps(
    workflows[0].source,
    'alint · expose the diff against the base as dirty changes',
  )[0];
  await exec('bash', ['-e', '-o', 'pipefail', '-c', runBlock(step)], {
    cwd,
    env: {
      ...f.env,
      BASE: f.push,
      FIXTURE_MERGE_BASE: f.base,
      GITHUB_REPOSITORY: 'fixture/upstream',
      HEAD_SHA: f.head,
      PATH: `${bin}:${process.env.PATH}`,
    },
  });
  assert.equal(await f.git(cwd, 'rev-parse', 'HEAD'), f.base);
  assert.equal(await f.git(cwd, 'status', '--porcelain'), '?? feature.txt');
  assert.equal(await readFile(path.join(cwd, 'shared.txt'), 'utf8'), 'original\n');
  assert.equal(await readFile(path.join(cwd, 'node_modules/installed'), 'utf8'), 'keep');
});

test('ALint consumers do not run if preparation of the PR-only working tree fails', () => {
  const source = workflows[0].source;
  assert.match(
    steps(source, 'alint · expose the diff against the base as dirty changes')[0],
    /id: alint_diff/,
  );
  for (const name of [
    'restore cache',
    'lint changed files',
    'calibrate rule fixtures (when rules or fixtures changed)',
  ]) {
    assert.match(steps(source, `alint · ${name}`)[0], /steps\.alint_diff\.outcome == 'success'/);
  }
});

test('E2E size baselines use the tested merge revision rather than the stale PR head', async () => {
  for (const name of [
    'Find latest canary baseline run',
    'Find latest canary entry-graph baseline run',
  ]) {
    const step = steps(workflows[1].source, name)[0];
    const script = step.split('          script: |\n')[1];
    assert.ok(script);
    let target;
    const require = () => async (args) => {
      target = args.targetSha;
    };
    const context = { sha: 'merge-sha', payload: { pull_request: { head: { sha: 'head-sha' } } } };
    await runInNewContext(`(async () => { ${script} })()`, { require, github: {}, context });
    assert.equal(target, context.sha);
  }
});
