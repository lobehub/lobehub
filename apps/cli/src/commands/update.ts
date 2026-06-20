import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';

import type { Command } from 'commander';
import pc from 'picocolors';
import semver from 'semver';

// Pull package metadata from the shared `src/pkg.ts` module (resolved at the
// bundled entry's depth) rather than a local `require('../../package.json')`,
// which would point outside the package once bundled into dist/index.js.
import { cliPackageName, cliVersion } from '../pkg';
import { log } from '../utils/logger';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const PACKAGE_MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

interface UpdateOptions {
  check?: boolean;
  packageManager?: PackageManager;
  tag?: string;
}

/**
 * Detect which package manager installed the CLI so we run the matching global
 * upgrade command. We first trust an explicit `npm_config_user_agent` (set when
 * invoked through a package-manager script) and otherwise infer from the path of
 * the running binary. Falls back to npm.
 */
export function detectPackageManager(): PackageManager {
  const ua = process.env.npm_config_user_agent;
  if (ua) {
    if (ua.startsWith('pnpm')) return 'pnpm';
    if (ua.startsWith('yarn')) return 'yarn';
    if (ua.startsWith('bun')) return 'bun';
    if (ua.startsWith('npm')) return 'npm';
  }

  try {
    const binPath = realpathSync(process.argv[1] ?? '').replaceAll('\\', '/');
    if (binPath.includes('/pnpm/')) return 'pnpm';
    if (binPath.includes('/.bun/') || binPath.includes('/bun/')) return 'bun';
    if (binPath.includes('/yarn/') || binPath.includes('/.yarn/')) return 'yarn';
  } catch {
    // ignore – fall back to npm
  }

  return 'npm';
}

/** Build the global-install command for the detected package manager. */
export function buildInstallCommand(
  pm: PackageManager,
  spec: string,
): { args: string[]; command: string } {
  switch (pm) {
    case 'pnpm': {
      return { args: ['add', '-g', spec], command: 'pnpm' };
    }
    case 'yarn': {
      return { args: ['global', 'add', spec], command: 'yarn' };
    }
    case 'bun': {
      return { args: ['add', '-g', spec], command: 'bun' };
    }
    default: {
      return { args: ['install', '-g', spec], command: 'npm' };
    }
  }
}

/**
 * Whether `latest` is a newer version than `current`. Delegates to `semver` so
 * prerelease identifiers order correctly (e.g. `1.0.0-beta.10` > `1.0.0-beta.9`,
 * which a lexicographic compare gets wrong). Tolerates a leading `v` and missing
 * segments via coercion; an unparseable `latest` is treated as "not newer".
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const latestParsed = semver.coerce(latest, { includePrerelease: true }) ?? semver.parse(latest);
  const currentParsed =
    semver.coerce(current, { includePrerelease: true }) ?? semver.parse(current);
  if (!latestParsed || !currentParsed) return false;
  return semver.gt(latestParsed, currentParsed);
}

async function fetchLatestVersion(name: string, tag: string): Promise<string> {
  const url = `https://registry.npmjs.org/${name}/${encodeURIComponent(tag)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(`npm registry returned status ${res.status} for tag "${tag}"`);
  }

  const data = (await res.json()) as { version?: string };
  if (!data.version) {
    throw new Error('npm registry response is missing the "version" field');
  }

  return data.version;
}

function runInstall(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? 'null'}`));
    });
  });
}

export function registerUpdateCommand(program: Command) {
  program
    .command('update')
    .description('Update the LobeHub CLI to the latest published version')
    .option('--check', 'Only check for a newer version without installing')
    .option('--tag <tag>', 'npm dist-tag to update to', 'latest')
    .option(
      '--package-manager <pm>',
      `Force a package manager (${PACKAGE_MANAGERS.join(', ')}) instead of auto-detecting`,
    )
    .action(async (options: UpdateOptions) => {
      if (options.packageManager && !PACKAGE_MANAGERS.includes(options.packageManager)) {
        log.error(
          `Unsupported package manager "${options.packageManager}". Use one of: ${PACKAGE_MANAGERS.join(', ')}.`,
        );
        process.exit(1);
        return;
      }

      const current = cliVersion;
      const tag = options.tag || 'latest';

      log.info(`Current version: ${pc.bold(current)}`);

      let latest: string;
      try {
        latest = await fetchLatestVersion(cliPackageName, tag);
      } catch (error) {
        log.error(`Unable to check for updates: ${(error as Error).message}`);
        process.exit(1);
        return;
      }

      log.info(`Latest version:  ${pc.bold(latest)} ${pc.dim(`(${tag})`)}`);

      if (!isNewerVersion(latest, current)) {
        log.info(pc.green('Already on the latest version.'));
        return;
      }

      if (options.check) {
        log.info(
          `Update available: ${current} → ${pc.green(latest)}. Run ${pc.cyan('lh update')} to upgrade.`,
        );
        return;
      }

      const pm = options.packageManager || detectPackageManager();
      const spec = `${cliPackageName}@${latest}`;
      const { args, command } = buildInstallCommand(pm, spec);

      log.info(`Upgrading via ${pc.bold(pm)}: ${pc.dim([command, ...args].join(' '))}`);

      try {
        await runInstall(command, args);
        log.info(pc.green(`Successfully updated to ${latest}. Restart any running sessions.`));
      } catch (error) {
        log.error(`Update failed: ${(error as Error).message}`);
        log.error(`You can upgrade manually: ${[command, ...args].join(' ')}`);
        process.exit(1);
      }
    });
}
