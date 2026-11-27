import { execFile, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';

import type { Command } from 'commander';
import pc from 'picocolors';
import semver from 'semver';

import { CLI_DISPLAY_NAME } from '../constants/identity';
// Pull package metadata from the shared `src/pkg.ts` module (resolved at the
// bundled entry's depth) rather than a local `require('../../package.json')`,
// which would point outside the package once bundled into dist/index.js.
import { cliPackageName, cliVersion } from '../pkg';
import { loadSettings, saveSettings } from '../settings';
import {
  acquireInstallLock,
  AUTO_UPDATE_WORKER_COMMAND,
  isAutoUpdateEnabled,
  isDaemonInstallRunning,
  releaseInstallLock,
} from '../utils/autoUpdate';
import { log } from '../utils/logger';
import { printConnectStatus } from './connectStatus';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const PACKAGE_MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

interface UpdateOptions {
  auto?: string;
  check?: boolean;
  packageManager?: PackageManager;
  tag?: string;
  verbose?: boolean;
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

async function fetchRegistryVersion(name: string, tag: string): Promise<string> {
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

/** `npm view` goes through the user's npm config: registry mirror, proxy and auth. */
function npmViewVersion(name: string, tag: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'npm',
      ['view', `${name}@${tag}`, 'version'],
      { encoding: 'utf8', shell: process.platform === 'win32', timeout: 30_000 },
      (error, stdout) => {
        const version = stdout?.trim();
        if (error || !version) reject(error ?? new Error('npm view printed no version'));
        else resolve(version);
      },
    );
  });
}

/**
 * Published version behind an npm dist-tag. Also used by `lh doctor` and the daemon updater.
 *
 * Node's `fetch` neither reads `HTTPS_PROXY` nor the npm config, so on networks that only reach
 * the registry through a proxy or a mirror the direct request fails while `npm install` works.
 * Fall back to `npm view`, which resolves the version the same way the install will.
 */
export async function fetchLatestVersion(name: string, tag: string): Promise<string> {
  try {
    return await fetchRegistryVersion(name, tag);
  } catch (error) {
    try {
      return await npmViewVersion(name, tag);
    } catch {
      throw error;
    }
  }
}

function runInstall(command: string, args: string[], quiet = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === 'win32',
      stdio: quiet ? 'ignore' : 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? 'null'}`));
    });
  });
}

function runEntry(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // The Node binary and entry path are passed as argv, never through a shell.
    const child = spawn(process.execPath, [process.argv[1], ...args], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`exited with code ${code ?? 'null'}`)),
    );
  });
}

/**
 * Let the CLI that was just installed report the connectors, so the user sees the new
 * version's detection rather than the code running this update. Report from this process
 * when the entry no longer runs the installed version (a versioned pnpm path, for example).
 */
export async function reportInstalledConnectStatus(installedVersion: string, verbose = false) {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        [process.argv[1], '--version'],
        { encoding: 'utf8', timeout: 30_000 },
        (error, output) => (error ? reject(error) : resolve(output)),
      );
    });
    if (stdout.trim() === installedVersion) {
      await runEntry(['connect', 'status', ...(verbose ? ['--verbose'] : [])]);
      return;
    }
  } catch (error) {
    log.debug(`Installed CLI report unavailable: ${(error as Error).message}`);
  }
  await printConnectStatus({ installedVersion, verbose });
}

/**
 * Background half of automatic updates, started detached by `maybeStartBackgroundUpdate`.
 * Installs silently; failures are dropped because nobody is watching this process and the
 * next check retries a day later.
 */
export async function runAutoUpdateWorker(): Promise<void> {
  if (!isAutoUpdateEnabled() || !acquireInstallLock()) return;
  try {
    if (isDaemonInstallRunning()) return;
    const latest = await fetchLatestVersion(cliPackageName, 'latest');
    if (!semver.valid(latest) || !isNewerVersion(latest, cliVersion)) return;
    const { args, command } = buildInstallCommand(
      detectPackageManager(),
      `${cliPackageName}@${latest}`,
    );
    await runInstall(command, args, true);
  } catch (error) {
    log.debug(`Automatic update failed: ${(error as Error).message}`);
  } finally {
    releaseInstallLock();
  }
}

function setAutoUpdates(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized !== 'on' && normalized !== 'off') {
    log.error(`Unsupported --auto value "${value}". Use on or off.`);
    return false;
  }
  const settings = loadSettings() ?? {};
  saveSettings({ ...settings, autoUpdates: normalized === 'off' ? false : undefined });
  log.info(
    normalized === 'off'
      ? 'Automatic updates are off. Run lh update to upgrade manually.'
      : 'Automatic updates are on.',
  );
  if (normalized === 'on' && !isAutoUpdateEnabled()) {
    log.warn(
      'LOBEHUB_CLI_DISABLE_AUTOUPDATE, CI, an agent run or a managed cloud device still keeps them off in this environment.',
    );
  }
  return true;
}

export function registerUpdateCommand(program: Command) {
  program
    .command(AUTO_UPDATE_WORKER_COMMAND, { hidden: true })
    .description('Internal command for background automatic updates')
    .action(runAutoUpdateWorker);

  program
    .command('update')
    .description(`Update the ${CLI_DISPLAY_NAME} to the latest published version`)
    .option('--check', 'Only check for a newer version without installing')
    .option(
      '--auto <on|off>',
      'Turn automatic updates on or off (on by default; LOBEHUB_CLI_DISABLE_AUTOUPDATE=1 also turns them off)',
    )
    .option('-v, --verbose', 'Include connector details and installation paths')
    .option('--tag <tag>', 'npm dist-tag to update to', 'latest')
    .option(
      '--package-manager <pm>',
      `Force a package manager (${PACKAGE_MANAGERS.join(', ')}) instead of auto-detecting`,
    )
    .action(async (options: UpdateOptions) => {
      if (options.auto !== undefined) {
        if (!setAutoUpdates(options.auto)) process.exit(1);
        return;
      }
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
        log.info(pc.green('Installed CLI is already on the latest version.'));
        await printConnectStatus({ verbose: options.verbose });
        return;
      }

      if (options.check) {
        await printConnectStatus({ verbose: options.verbose });
        log.info(
          `Update available: ${current} → ${pc.green(latest)}. Run ${pc.cyan('lh update')} to upgrade.`,
        );
        return;
      }

      const pm = options.packageManager || detectPackageManager();
      const spec = `${cliPackageName}@${latest}`;
      const { args, command } = buildInstallCommand(pm, spec);

      log.info(`Upgrading via ${pc.bold(pm)}: ${pc.dim([command, ...args].join(' '))}`);

      // Two installs into one global package directory can leave a broken CLI behind.
      if (isDaemonInstallRunning() || !acquireInstallLock()) {
        log.error('A background CLI update is installing. Retry in a few minutes.');
        process.exit(1);
        return;
      }
      try {
        await runInstall(command, args);
      } catch (error) {
        // `process.exit` skips the `finally` below.
        releaseInstallLock();
        log.error(`Update failed: ${(error as Error).message}`);
        log.error(`You can upgrade manually: ${[command, ...args].join(' ')}`);
        process.exit(1);
        return;
      } finally {
        releaseInstallLock();
      }
      log.info(pc.green(`CLI installation updated: ${current} → ${latest}.`));
      log.info(
        'Running connectors were not restarted. Their version and connection are shown below; the update takes effect for each connector after it restarts.',
      );
      await reportInstalledConnectStatus(latest, options.verbose);
    });
}
