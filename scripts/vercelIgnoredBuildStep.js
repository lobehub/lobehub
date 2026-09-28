/* eslint-disable @typescript-eslint/no-require-imports */
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const GIT_FETCH_TIMEOUT_MS = 15_000;

const isValidCommitSha = (value) => /^[0-9a-f]{7,64}$/i.test(value);

const isNonRuntimePath = (filePath) =>
  filePath === '.github' ||
  filePath.startsWith('.github/') ||
  (!filePath.includes('/') && /\.md$/i.test(filePath));

const runGit = async (args) => {
  try {
    const { stdout } = await execFileAsync('git', args, { encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return null;
  }
};

const hasGitObject = async (revision) => {
  try {
    await execFileAsync('git', ['cat-file', '-e', `${revision}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

const fetchGitObject = async (revision) => {
  try {
    await execFileAsync('git', ['fetch', '--no-tags', '--depth=1', 'origin', revision], {
      encoding: 'utf8',
      timeout: GIT_FETCH_TIMEOUT_MS,
    });
    return hasGitObject(revision);
  } catch {
    return false;
  }
};

const buildConservatively = (message) => {
  console.log(message);
  return true;
};

/**
 * Compare with the last successful deployment, fetching its tree for shallow checkouts.
 * Missing comparison data must build; HEAD^ can hide source changes behind a later CI commit.
 * https://vercel.com/docs/environment-variables/system-environment-variables#vercel_git_previous_sha
 */
const shouldProceedBuild = async () => {
  if (process.env.VERCEL_ENV !== 'preview') return true;

  const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA;
  if (!previousSha || !isValidCommitSha(previousSha)) {
    return buildConservatively('No valid previous deployment baseline; building conservatively.');
  }

  const currentSha = await runGit(['rev-parse', '--verify', 'HEAD']);
  if (!currentSha)
    return buildConservatively('Current commit unavailable; building conservatively.');

  const previousCommitAvailable =
    (await hasGitObject(previousSha)) || (await fetchGitObject(previousSha));
  if (!previousCommitAvailable) {
    return buildConservatively(
      'Previous deployment baseline unavailable; building conservatively.',
    );
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        'diff',
        '--no-renames',
        '--name-only',
        '--diff-filter=ACDMRTUXB',
        '-z',
        previousSha,
        currentSha,
        '--',
      ],
      { encoding: 'utf8' },
    );
    const changedFiles = stdout.split('\0').filter(Boolean);

    return changedFiles.some((filePath) => !isNonRuntimePath(filePath));
  } catch {
    return buildConservatively('Unable to inspect deployment diff; building conservatively.');
  }
};

shouldProceedBuild()
  .catch(() => buildConservatively('Unable to inspect deployment diff; building conservatively.'))
  .then((shouldBuild) => {
    console.log('shouldBuild:', shouldBuild);
    console.log(shouldBuild ? '✅ - Build can proceed' : '🛑 - Build cancelled');
    process.exitCode = shouldBuild ? 1 : 0;
  });
