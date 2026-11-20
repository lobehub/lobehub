import { execFile, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';

import { confirm, input, select } from '@inquirer/prompts';
import { consola } from 'consola';
import * as semver from 'semver';

import { createGithubStore } from '../../.github/scripts/desktopReleaseGithub.mjs';
import { formatIntent } from '../../.github/scripts/desktopReleaseIntent.mjs';
import { deliveredBaseline, sourcesHash } from '../../.github/scripts/desktopReleaseSources.mjs';

const ROOT_DIR = process.cwd();
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');
const exec = promisify(execFile);

interface HotfixSources {
  baseOssSha: string;
  baseSourcesHash: string;
  baseVersion: string;
  cloudSha: string;
  overrideReason?: string;
}

async function chooseSources(options: {
  'base'?: string;
  'cloud-ref'?: string;
  'reason'?: string;
}): Promise<HotfixSources> {
  const repository =
    process.env.GITHUB_REPOSITORY ||
    (
      await exec('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    ).stdout.trim();
  const token =
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    (await exec('gh', ['auth', 'token'])).stdout.trim();
  const store = createGithubStore({ repository, token, apiUrl: process.env.GITHUB_API_URL });
  let base = options.base;
  if (!base) {
    const candidates = await store.listDelivered();
    if (!candidates.length)
      throw new Error(
        'No Stable release has recorded delivery proof; restore and verify a baseline first.',
      );
    base = await select({
      message: 'Which delivered Stable release should this hotfix repair?',
      choices: candidates.map((candidate: { cloudSha: string; version: string }) => ({
        name: `v${candidate.version} — Cloud ${candidate.cloudSha.slice(0, 8)}`,
        value: candidate.version,
      })),
    });
  }
  const baseline = await deliveredBaseline(store, base);
  const mainSha = (await exec('git', ['rev-parse', 'origin/main'])).stdout.trim();
  await store.assertHotfixBase(baseline, mainSha);
  const cloudSha = options['cloud-ref'] || baseline.cloudSha;
  if (cloudSha !== baseline.cloudSha && !options.reason?.trim())
    throw new Error('--cloud-ref requires --reason when changing the inherited Cloud source');
  const result = {
    baseVersion: baseline.version,
    baseOssSha: baseline.ossSha,
    baseSourcesHash: sourcesHash(baseline),
    cloudSha,
    ...(options.reason && { overrideReason: options.reason }),
  };
  // Validate the exact metadata before pushing a branch or creating a PR.
  formatIntent({ schemaVersion: 1, mode: 'hotfix', ...result });
  return result;
}

function checkGitRepo(): void {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
  } catch {
    consola.error('❌ Current directory is not a Git repository');
    process.exit(1);
  }
}

function getCurrentBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch {
    consola.error('❌ Unable to determine current branch');
    process.exit(1);
  }
}

function getCurrentVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    return pkg.version;
  } catch {
    consola.error('❌ Unable to read version from package.json');
    process.exit(1);
  }
}

function bumpPatchVersion(currentVersion: string): string {
  const parsed = semver.parse(currentVersion);
  if (!parsed) {
    consola.error(`❌ Invalid semver version in package.json: ${currentVersion}`);
    process.exit(1);
  }

  // If current is a pre-release, hotfix should still be a stable patch (e.g. 2.0.0-beta.1 -> 2.0.1)
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  const next = semver.inc(base, 'patch');
  if (!next) {
    consola.error(`❌ Unable to calculate patch version from: ${base}`);
    process.exit(1);
  }
  return next;
}

function createHotfixBranchName(version: string): string {
  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    if (!hash) {
      consola.error('❌ Unable to determine current commit hash for branch suffix');
      process.exit(1);
    }
    return `hotfix/v${version}-${hash}`;
  } catch (error) {
    consola.error('❌ Failed to generate hotfix branch name');
    consola.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function confirmHotfix(opts: {
  branchName: string;
  currentVersion: string;
  isExistingBranch: boolean;
  sources: HotfixSources;
  version: string;
}): Promise<boolean> {
  const { version, currentVersion, branchName, isExistingBranch, sources } = opts;
  consola.info(
    `Base: v${sources.baseVersion}\nOSS: ${sources.baseOssSha}\nCloud: ${sources.cloudSha}`,
  );

  if (isExistingBranch) {
    consola.box(
      `
🩹 Hotfix PR (existing branch)
━━━━━━━━━━━━━━━━━━━━━━━
Branch:     ${branchName}
Version:    ${version}
Target:     main
━━━━━━━━━━━━━━━━━━━━━━━
    `.trim(),
    );

    return await confirm({
      default: true,
      message: 'Confirm to push and submit PR for this hotfix branch?',
    });
  }

  consola.box(
    `
🩹 Hotfix Confirmation
━━━━━━━━━━━━━━━━━━━━━━━
Current:    ${currentVersion}
New:        ${version}
Branch:     ${branchName}
Target:     main
━━━━━━━━━━━━━━━━━━━━━━━
  `.trim(),
  );

  return await confirm({
    default: true,
    message: 'Confirm to create hotfix branch and submit PR?',
  });
}

function createHotfixBranch(branchName: string): void {
  try {
    consola.info(`🌿 Creating branch: ${branchName}...`);
    execSync(`git checkout -b ${branchName}`, { stdio: 'inherit' });
    consola.success(`✅ Created and switched to branch: ${branchName}`);
  } catch (error) {
    consola.error(`❌ Failed to create branch: ${branchName}`);
    consola.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function pushBranch(branchName: string): void {
  try {
    consola.info('📤 Pushing branch to remote...');
    execSync(`git push -u origin ${branchName}`, { stdio: 'inherit' });
    consola.success(`✅ Pushed branch to remote: ${branchName}`);
  } catch (error) {
    consola.error('❌ Failed to push branch');
    consola.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function createPullRequest(
  version: string,
  branchName: string,
  sources: HotfixSources,
): Promise<void> {
  const title = await input({
    default: `🐛 fix: hotfix v${version}`,
    message: 'PR title:',
  });
  const body = `## 🩹 Hotfix v${version}

This PR starts a hotfix release from \`main\`.

### Desktop sources
- Base release: v${sources.baseVersion}
- Base OSS: \`${sources.baseOssSha}\`
- Cloud: \`${sources.cloudSha}\`
${sources.overrideReason ? `- Cloud repair: ${sources.overrideReason}\n` : ''}
${formatIntent({ schemaVersion: 1, mode: 'hotfix', ...sources })}

### Release Process
1. ✅ Hotfix branch created from main
2. ✅ Pushed to remote
3. 🔄 Waiting for PR review and merge
4. ⏳ Auto tag + GitHub Release will be created after merge

---
Created by hotfix script`;

  const directory = await mkdtemp(path.join(tmpdir(), 'lobehub-hotfix-'));
  try {
    consola.info('🔀 Creating Pull Request...');
    const bodyFile = path.join(directory, 'body.md');
    await writeFile(bodyFile, body);
    const result = await exec('gh', [
      'pr',
      'create',
      '--title',
      title,
      '--body-file',
      bodyFile,
      '--base',
      'main',
      '--head',
      branchName,
    ]);
    consola.info(result.stdout.trim());
    consola.success('✅ PR created successfully!');
  } catch (error) {
    consola.error('❌ Failed to create PR');
    consola.error(error instanceof Error ? error.message : String(error));
    consola.info('\n💡 Tip: Make sure GitHub CLI (gh) is installed and logged in');
    consola.info('   Install: https://cli.github.com/');
    consola.info('   Login: gh auth login');
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function showCompletion(version: string, branchName: string): void {
  consola.box(
    `
🎉 Hotfix process started!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Branch created: ${branchName}
✅ Pushed to remote
✅ PR created targeting main branch

📋 PR Title: 🐛 hotfix: v${version}

Next steps:
1. Open the PR link to view details
2. Complete code review
3. Merge PR to main branch
4. Wait for release workflows to complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim(),
  );
}

function extractVersionFromBranch(branchName: string): string | null {
  const match = branchName.match(/^hotfix\/v(.+?)(?:-[a-f0-9]+)?$/);
  return match ? match[1] : null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'base': { type: 'string' },
      'cloud-ref': { type: 'string' },
      'reason': { type: 'string' },
      'help': { type: 'boolean' },
    },
  });
  if (values.help) {
    consola.log(
      'Usage: bun run hotfix:branch [--base v2.2.21] [--cloud-ref <SHA> --reason <repair>]',
    );
    consola.log(
      'Without --base, select a Stable release with matching source and delivery records.',
    );
    return;
  }
  consola.info('🩹 LobeChat Hotfix Script\n');

  checkGitRepo();

  const currentBranch = getCurrentBranch();
  const isOnMain = currentBranch === 'main';
  const isOnHotfix = currentBranch.startsWith('hotfix/');

  if (!isOnMain && !isOnHotfix) {
    consola.error(`❌ Current branch "${currentBranch}" is neither main nor a hotfix branch`);
    consola.info('💡 Please switch to main or an existing hotfix branch first');
    process.exit(1);
  }

  if (isOnHotfix) {
    consola.info(`🔍 Detected existing hotfix branch: ${currentBranch}`);

    const currentVersion = getCurrentVersion();
    const version = extractVersionFromBranch(currentBranch) ?? bumpPatchVersion(currentVersion);
    await exec('git', ['fetch', 'origin', 'main']);
    const sources = await chooseSources(values);

    const confirmed = await confirmHotfix({
      branchName: currentBranch,
      currentVersion,
      isExistingBranch: true,
      version,
      sources,
    });
    if (!confirmed) {
      consola.info('❌ Hotfix process cancelled');
      process.exit(0);
    }

    pushBranch(currentBranch);
    await createPullRequest(version, currentBranch, sources);
    showCompletion(version, currentBranch);
  } else {
    consola.info('📥 Pulling latest main branch...');
    execSync('git pull --rebase origin main', { stdio: 'inherit' });

    const currentVersion = getCurrentVersion();
    const newVersion = bumpPatchVersion(currentVersion);
    const branchName = createHotfixBranchName(newVersion);
    const sources = await chooseSources(values);

    const confirmed = await confirmHotfix({
      branchName,
      currentVersion,
      isExistingBranch: false,
      version: newVersion,
      sources,
    });
    if (!confirmed) {
      consola.info('❌ Hotfix process cancelled');
      process.exit(0);
    }

    createHotfixBranch(branchName);
    pushBranch(branchName);
    await createPullRequest(newVersion, branchName, sources);
    showCompletion(newVersion, branchName);
  }
}

main().catch((error) => {
  consola.error('❌ Error occurred:', error);
  process.exit(1);
});
