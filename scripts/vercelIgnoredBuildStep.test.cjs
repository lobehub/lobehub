const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { copyFile, mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { test } = require('node:test');

const execFileAsync = promisify(execFile);
const sourceScript = path.join(__dirname, 'vercelIgnoredBuildStep.js');

const runGit = (repoRoot, args) =>
  execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });

const commit = async (repoRoot, message) => {
  await runGit(repoRoot, ['add', '--all']);
  await runGit(repoRoot, ['commit', '-q', '-m', message]);
  const { stdout } = await runGit(repoRoot, ['rev-parse', 'HEAD']);
  return stdout.trim();
};

const writeRepoFile = async (repoRoot, relativePath, contents) => {
  const filePath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
};

const createRepository = async (t) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vercel-ignore-step-'));
  t.after(() => rm(repoRoot, { force: true, recursive: true }));

  await runGit(repoRoot, ['init', '-q']);
  await runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
  await runGit(repoRoot, ['config', 'user.name', 'Test']);
  await mkdir(path.join(repoRoot, 'scripts'), { recursive: true });
  await copyFile(sourceScript, path.join(repoRoot, 'scripts/vercelIgnoredBuildStep.js'));
  await writeRepoFile(repoRoot, 'src/app.js', 'export const app = true;\n');
  const baseSha = await commit(repoRoot, 'base');

  return { baseSha, repoRoot };
};

const createShallowRepository = async (t, changedPath, contents) => {
  const remoteRoot = await mkdtemp(path.join(os.tmpdir(), 'vercel-ignore-remote-'));
  const cloneParent = await mkdtemp(path.join(os.tmpdir(), 'vercel-ignore-clone-'));
  t.after(() =>
    Promise.all([
      rm(remoteRoot, { force: true, recursive: true }),
      rm(cloneParent, { force: true, recursive: true }),
    ]),
  );

  await runGit(remoteRoot, ['init', '-q']);
  await runGit(remoteRoot, ['config', 'user.email', 'test@example.com']);
  await runGit(remoteRoot, ['config', 'user.name', 'Test']);
  await mkdir(path.join(remoteRoot, 'scripts'), { recursive: true });
  await copyFile(sourceScript, path.join(remoteRoot, 'scripts/vercelIgnoredBuildStep.js'));
  await writeRepoFile(remoteRoot, 'src/app.js', 'export const app = true;\n');
  const baseSha = await commit(remoteRoot, 'base');
  await commitFile(remoteRoot, changedPath, contents, 'change');

  await runGit(cloneParent, ['clone', '-q', '--depth=1', `file://${remoteRoot}`, 'repo']);

  return { baseSha, repoRoot: path.join(cloneParent, 'repo') };
};

const commitFile = async (repoRoot, relativePath, contents, message) => {
  await writeRepoFile(repoRoot, relativePath, contents);
  return commit(repoRoot, message);
};

const runIgnoreStep = async (repoRoot, env = {}) => {
  try {
    const result = await execFileAsync(process.execPath, ['scripts/vercelIgnoredBuildStep.js'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        VERCEL_ENV: 'preview',
        ...env,
      },
    });

    return { code: 0, ...result };
  } catch (error) {
    return {
      code: error.code,
      stderr: error.stderr,
      stdout: error.stdout,
    };
  }
};

test('skips preview deployments for CI-only and root Markdown changes', async (t) => {
  const { baseSha, repoRoot } = await createRepository(t);

  await commitFile(repoRoot, '.github/workflows/test.yml', 'name: Test\n', 'CI change');
  let result = await runIgnoreStep(repoRoot, { VERCEL_GIT_PREVIOUS_SHA: baseSha });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /shouldBuild: false/);

  await commitFile(repoRoot, 'README.md', '# Docs\n', 'Docs change');
  result = await runIgnoreStep(repoRoot, { VERCEL_GIT_PREVIOUS_SHA: baseSha });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /shouldBuild: false/);
});

test('builds when a source change is followed by a CI-only commit', async (t) => {
  const { baseSha, repoRoot } = await createRepository(t);

  await commitFile(repoRoot, 'src/app.js', 'export const app = false;\n', 'Source change');
  await commitFile(repoRoot, '.github/workflows/test.yml', 'name: Test\n', 'CI change');

  const result = await runIgnoreStep(repoRoot, { VERCEL_GIT_PREVIOUS_SHA: baseSha });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /shouldBuild: true/);
});

test('builds when a runtime file is renamed into an ignored directory', async (t) => {
  const { baseSha, repoRoot } = await createRepository(t);

  await mkdir(path.join(repoRoot, '.github'), { recursive: true });
  await runGit(repoRoot, ['mv', 'src/app.js', '.github/app.js']);
  await commit(repoRoot, 'Move runtime file');

  const result = await runIgnoreStep(repoRoot, { VERCEL_GIT_PREVIOUS_SHA: baseSha });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /shouldBuild: true/);
});

test('builds for runtime scripts and Vercel configuration changes', async (t) => {
  const { baseSha, repoRoot } = await createRepository(t);

  await commitFile(repoRoot, 'scripts/build.js', 'console.log("build");\n', 'Build script change');
  let result = await runIgnoreStep(repoRoot, { VERCEL_GIT_PREVIOUS_SHA: baseSha });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /shouldBuild: true/);

  await commitFile(
    repoRoot,
    'vercel.json',
    '{"buildCommand":"next build"}\n',
    'Vercel config change',
  );
  result = await runIgnoreStep(repoRoot, { VERCEL_GIT_PREVIOUS_SHA: baseSha });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /shouldBuild: true/);
});

test('builds when the previous deployment baseline is missing, invalid, or unavailable', async (t) => {
  const { repoRoot } = await createRepository(t);
  await commitFile(repoRoot, '.github/workflows/test.yml', 'name: Test\n', 'CI change');

  let result = await runIgnoreStep(repoRoot);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /shouldBuild: true/);

  result = await runIgnoreStep(repoRoot, { VERCEL_GIT_PREVIOUS_SHA: 'not-a-commit' });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /shouldBuild: true/);

  result = await runIgnoreStep(repoRoot, {
    VERCEL_GIT_PREVIOUS_SHA: '0000000000000000000000000000000000000000',
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /shouldBuild: true/);
});

test('fetches a missing baseline before skipping CI-only changes', async (t) => {
  const { baseSha, repoRoot } = await createShallowRepository(
    t,
    '.github/workflows/test.yml',
    'name: Test\n',
  );

  const result = await runIgnoreStep(repoRoot, { VERCEL_GIT_PREVIOUS_SHA: baseSha });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /shouldBuild: false/);
});

test('fetches a missing baseline before building for runtime changes', async (t) => {
  const { baseSha, repoRoot } = await createShallowRepository(
    t,
    'src/app.js',
    'export const app = false;\n',
  );

  const result = await runIgnoreStep(repoRoot, { VERCEL_GIT_PREVIOUS_SHA: baseSha });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /shouldBuild: true/);
});

test('always builds production deployments', async (t) => {
  const { baseSha, repoRoot } = await createRepository(t);
  await commitFile(repoRoot, '.github/workflows/test.yml', 'name: Test\n', 'CI change');

  const result = await runIgnoreStep(repoRoot, {
    VERCEL_ENV: 'production',
    VERCEL_GIT_PREVIOUS_SHA: baseSha,
  });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /shouldBuild: true/);
});
