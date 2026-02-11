import { execFileSync, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { confirm, input } from '@inquirer/prompts';
import { consola } from 'consola';
import * as semver from 'semver';

const ROOT_DIR = process.cwd();
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');

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
  version: string;
}): Promise<boolean> {
  const { version, currentVersion, branchName, isExistingBranch } = opts;

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

async function createPullRequest(version: string, branchName: string): Promise<void> {
  const title = await input({
    default: `🐛 fix: hotfix v${version}`,
    message: 'PR title:',
  });
  const body = `## 🩹 Hotfix v${version}

This PR starts a hotfix release from \`main\`.

### Release Process
1. ✅ Hotfix branch created from main
2. ✅ Pushed to remote
3. 🔄 Waiting for PR review and merge
4. ⏳ Auto tag + GitHub Release will be created after merge

---
Created by hotfix script`;

  try {
    consola.info('🔀 Creating Pull Request...');
    execFileSync(
      'gh',
      ['pr', 'create', '--title', title, '--body', body, '--base', 'main', '--head', branchName],
      { stdio: 'inherit' },
    );
    consola.success('✅ PR created successfully!');
  } catch (error) {
    consola.error('❌ Failed to create PR');
    consola.error(error instanceof Error ? error.message : String(error));
    consola.info('\n💡 Tip: Make sure GitHub CLI (gh) is installed and logged in');
    consola.info('   Install: https://cli.github.com/');
    consola.info('   Login: gh auth login');
    process.exit(1);
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

  const currentVersion = getCurrentVersion();

  if (isOnHotfix) {
    consola.info(`🔍 Detected existing hotfix branch: ${currentBranch}`);

    const version = extractVersionFromBranch(currentBranch) ?? bumpPatchVersion(currentVersion);

    const confirmed = await confirmHotfix({
      branchName: currentBranch,
      currentVersion,
      isExistingBranch: true,
      version,
    });
    if (!confirmed) {
      consola.info('❌ Hotfix process cancelled');
      process.exit(0);
    }

    pushBranch(currentBranch);
    await createPullRequest(version, currentBranch);
    showCompletion(version, currentBranch);
  } else {
    consola.info('📥 Pulling latest main branch...');
    execSync('git pull --rebase origin main', { stdio: 'inherit' });

    const newVersion = bumpPatchVersion(currentVersion);
    const branchName = createHotfixBranchName(newVersion);

    const confirmed = await confirmHotfix({
      branchName,
      currentVersion,
      isExistingBranch: false,
      version: newVersion,
    });
    if (!confirmed) {
      consola.info('❌ Hotfix process cancelled');
      process.exit(0);
    }

    createHotfixBranch(branchName);
    pushBranch(branchName);
    await createPullRequest(newVersion, branchName);
    showCompletion(newVersion, branchName);
  }
}

main().catch((error) => {
  consola.error('❌ Error occurred:', error);
  process.exit(1);
});
