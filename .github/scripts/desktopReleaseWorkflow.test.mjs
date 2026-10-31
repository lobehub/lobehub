import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  fixtureCloud,
  fixtureNextCloud,
  fixtureSources,
  startGithubFixture,
} from './desktopReleaseTestUtils.mjs';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../..', import.meta.url));
const workflow = await readFile(
  new URL('../workflows/release-desktop-stable.yml', import.meta.url),
  'utf8',
);
const setup = await readFile(
  new URL('../actions/desktop-build-setup/action.yml', import.meta.url),
  'utf8',
);

function shippedStep(source, name) {
  const section = source.split(`- name: ${name}\n`)[1]?.split(/\n *- (?:name:|uses:)/)[0];
  const block = section?.match(/^( +)run: \|\n/m);
  assert.ok(block, `shipped run step ${name} exists`);
  const indent = block[1].length + 2;
  const lines = [];
  for (const line of section.slice(block.index + block[0].length).split('\n')) {
    if (line.trim() && !line.startsWith(' '.repeat(indent))) break;
    lines.push(line.slice(indent));
  }
  return lines.join('\n').trimEnd();
}

test('the shipped Stable resolver reuses its old Cloud when the current HEAD has advanced', async (t) => {
  const github = await startGithubFixture();
  t.after(github.close);
  github.addAsset('2.2.21', 'desktop-sources.v1.json', JSON.stringify(fixtureSources));
  const root = await mkdtemp(path.join(os.tmpdir(), 'stable-resolver-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'outputs');
  // The original Bash resolver obtains B here. The repaired Node resolver reads A from GitHub.
  await exec(
    'bash',
    [
      '-c',
      `git() { printf '%s\\tHEAD\\n' "$NEW_CLOUD"; }\n${shippedStep(workflow, 'Resolve Cloud revision')}`,
    ],
    {
      cwd: repository,
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        RUNNER_TEMP: root,
        GITHUB_REPOSITORY: 'example/lobehub',
        GITHUB_API_URL: github.apiUrl,
        GH_TOKEN: 'oss-test-token',
        CLOUD_TOKEN: 'cloud-test-token',
        CLOUD_REPOSITORY: 'example/cloud',
        RELEASE_VERSION: '2.2.21',
        RELEASE_MODE: 'rebuild',
        SOURCE_REF: 'v2.2.21',
        GITHUB_RUN_ID: '40841847688',
        GITHUB_RUN_ATTEMPT: '3',
        WRITE_SOURCES: 'false',
        REQUESTED_CLOUD_REF: '',
        NEW_CLOUD: fixtureNextCloud,
      },
    },
  );
  const values = Object.fromEntries(
    (await readFile(output, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  );
  assert.equal(values.cloud_sha || values.cloud_ref, fixtureCloud);
});

test('the shipped setup refuses missing Stable Cloud credentials or an unpinned ref before installing', async () => {
  const script = shippedStep(setup, 'Validate pinned Stable sources');
  for (const overrides of [{ CLOUD_REF: '' }, { CLOUD_REF: 'main' }, { CLOUD_TOKEN: '' }]) {
    await assert.rejects(
      exec('bash', ['-c', script], {
        env: {
          ...process.env,
          REQUIRE_PINNED_CLOUD: 'true',
          CLOUD_REF: fixtureCloud,
          CLOUD_TOKEN: 'test-only',
          ...overrides,
        },
      }),
    );
  }
  await exec('bash', ['-c', script], {
    env: {
      ...process.env,
      REQUIRE_PINNED_CLOUD: 'true',
      CLOUD_REF: fixtureCloud,
      CLOUD_TOKEN: 'test-only',
    },
  });
});

test('the shipped source checkout guard validates the product SHA before restoring the new tooling', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stable-checkout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = path.join(root, 'tools');
  const product = path.join(root, 'product');
  const runner = path.join(root, 'runner');
  await mkdir(path.join(tools, '.github/scripts'), { recursive: true });
  await mkdir(product);
  await mkdir(runner);
  for (const name of [
    'desktopReleaseSources.mjs',
    'desktopReleaseGithub.mjs',
    'desktopReleaseIntent.mjs',
    'desktopReleaseCli.mjs',
  ])
    await copyFile(
      path.join(repository, '.github/scripts', name),
      path.join(tools, '.github/scripts', name),
    );
  await writeFile(path.join(tools, '.github/scripts/marker'), 'current tooling');
  await exec('git', ['init', tools]);
  await exec('git', ['-C', tools, 'add', '.github']);
  await exec('git', [
    '-C',
    tools,
    '-c',
    'user.name=Release test',
    '-c',
    'user.email=test@example.test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'tooling fixture',
  ]);
  await exec('git', ['init', product]);
  await writeFile(path.join(product, 'product.txt'), 'old application');
  await exec('git', ['-C', product, 'add', 'product.txt']);
  await exec('git', [
    '-C',
    product,
    '-c',
    'user.name=Release test',
    '-c',
    'user.email=test@example.test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'fixture',
  ]);
  const sha = (await exec('git', ['-C', product, 'rev-parse', 'HEAD'])).stdout.trim();
  // The preserve step runs in a tooling checkout; use a separate real product repository afterward.
  const env = {
    ...process.env,
    RUNNER_TEMP: runner,
    GITHUB_ENV: path.join(root, 'env'),
    RELEASE_OSS_SHA: sha,
    CLOUD_REF: fixtureCloud,
    SOURCES_HASH: 'a'.repeat(64),
    DESKTOP_TOOLING_SHA: 'b'.repeat(40),
  };
  await exec('bash', ['-c', shippedStep(workflow, 'Preserve release tooling')], {
    cwd: tools,
    env,
  });
  await exec('bash', ['-c', shippedStep(workflow, 'Verify product sources and restore tooling')], {
    cwd: product,
    env,
  });
  assert.equal(
    await readFile(path.join(product, '.github/scripts/marker'), 'utf8'),
    'current tooling',
  );
  assert.equal(await readFile(path.join(product, 'product.txt'), 'utf8'), 'old application');
  const diagnostics = JSON.parse(
    await readFile(path.join(product, 'desktop-ota-diagnostics/sources.json'), 'utf8'),
  );
  assert.equal(diagnostics.ossSha, sha);
  await assert.rejects(
    exec('bash', ['-c', shippedStep(workflow, 'Verify product sources and restore tooling')], {
      cwd: product,
      env: { ...env, RELEASE_OSS_SHA: '0'.repeat(40) },
    }),
  );
});
