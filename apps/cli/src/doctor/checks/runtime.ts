import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import semver from 'semver';
import { xSync } from 'tinyexec';

import { credentialsPath } from '../../auth/source';
import { detectPackageManager, fetchLatestVersion, isNewerVersion } from '../../commands/update';
import { resolveCliDirName } from '../../constants/identity';
import { cliNodeEngine, cliPackageName, cliVersion } from '../../pkg';
import type { CheckOutcome, DoctorCheck } from '../types';

const configDir = (): string => path.join(os.homedir(), resolveCliDirName());

const bytesToGb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/**
 * The runtime the CLI is actually running on.
 *
 * Known gap: this cannot fire for the case it most wants to catch. The bundle
 * imports `zstdDecompress` from `node:zlib` (node >= 22.15) and ESM resolves
 * every import before the first line runs, so on an older runtime `lh` dies
 * with "no export named 'zstdDecompress'" — pointing at node:zlib rather than
 * at the node it is running on — and no in-process check is ever reached.
 * Closing that needs a change to how the CLI is launched, which belongs in its
 * own change rather than riding along with a diagnostic command. Until then
 * this check covers the case where the bundle loads but the runtime is still
 * below the floor.
 */
const nodeVersion: DoctorCheck = {
  group: 'runtime',
  id: 'runtime.node',
  profiles: ['core'],
  run: (): CheckOutcome => {
    const required = cliNodeEngine ?? '>=22.15';
    const current = process.versions.node;
    const satisfied = semver.satisfies(current, required, { includePrerelease: true });
    const hasZstd = typeof (zlib as { zstdDecompress?: unknown }).zstdDecompress === 'function';
    const evidence = {
      hasZstd,
      nodeVersion: current,
      platform: `${process.platform}/${process.arch}`,
      required,
    };

    if (!satisfied)
      return {
        detail: `node v${current} is below the required ${required}.`,
        evidence,
        fix: 'Install node >= 22.15 (nvm install 22 / fnm install 22) and re-run.',
        status: 'fail',
      };

    if (!hasZstd)
      return {
        detail: `node v${current} satisfies ${required} but does not expose zlib.zstdDecompress.`,
        evidence,
        fix: 'Use an official node build — this runtime is missing APIs the CLI imports at startup.',
        status: 'fail',
      };

    return {
      detail: `node v${current} on ${process.platform}/${process.arch}.`,
      evidence,
      status: 'ok',
    };
  },
  title: 'node runtime',
};

/** Which `lh` is actually running, and whether another one shadows it. */
const cliInstall: DoctorCheck = {
  group: 'runtime',
  id: 'runtime.install',
  profiles: ['core'],
  run: (): CheckOutcome => {
    let entry = process.argv[1] ?? '';
    try {
      entry = fs.realpathSync(entry);
    } catch {
      // A bundled or virtual entry path is still worth reporting verbatim.
    }

    const installs = listInstalls();
    const packageManager = detectPackageManager();
    const evidence = { entry, installs, packageManager, version: cliVersion };

    if (installs.length > 1)
      return {
        // PATH order decides which one a bare `lh` runs, and they can be
        // different builds — an npm global next to a desktop-bundled copy.
        detail: `PATH resolves lh to ${installs[0]}, shadowing ${installs.length - 1} other install(s).`,
        evidence,
        fix: `Remove the ones you don't want: ${installs.slice(1).join(', ')}.`,
        status: 'warn',
      };

    return { detail: `${cliVersion} from ${entry} (${packageManager}).`, evidence, status: 'ok' };
  },
  title: 'cli install',
};

function listInstalls(): string[] {
  try {
    const { stdout } = xSync(
      process.platform === 'win32' ? 'where' : 'which',
      [...(process.platform === 'win32' ? [] : ['-a']), 'lh'],
      { nodeOptions: { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }, nodePath: false },
    );

    const resolved = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((candidate) => {
        try {
          return fs.realpathSync(candidate);
        } catch {
          return candidate;
        }
      });

    return [...new Set(resolved)];
  } catch {
    return [];
  }
}

/**
 * The CLI home holds credentials, the daemon's pid/status, the connection id
 * and the persisted workspace scope. An unwritable or world-readable one
 * degrades in ways that surface much later as "why did it forget my login".
 */
const cliHome: DoctorCheck = {
  group: 'runtime',
  id: 'runtime.home',
  profiles: ['core'],
  repair: (_ctx, result) => {
    // The check reports two different broken states; repair only the one it
    // actually found, or a loose-permission warning would silently move a
    // perfectly good settings.json aside.
    const repairable = result.evidence?.repairable;

    if (repairable === 'settings') {
      const settingsFile = path.join(configDir(), 'settings.json');
      // Re-confirm at repair time: only a file that reads and fails to parse
      // is moved aside.
      let stillCorrupt = false;
      try {
        JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      } catch (error) {
        stillCorrupt = error instanceof SyntaxError;
      }
      if (!stillCorrupt) throw new Error('settings.json is no longer unparseable; left in place');

      // Never clobber an earlier backup: the second corruption would destroy
      // the copy the first repair preserved, which nothing has diagnosed.
      let backup = `${settingsFile}.bak`;
      if (fs.existsSync(backup)) backup = `${settingsFile}.${Date.now()}.bak`;
      fs.renameSync(settingsFile, backup);
      return `moved the unparseable settings.json to ${backup}`;
    }

    if (repairable === 'permissions') {
      const targets = (result.evidence?.loosePermissions as string[] | undefined) ?? [];
      for (const target of targets)
        fs.chmodSync(target, fs.statSync(target).isDirectory() ? 0o700 : 0o600);
      return `tightened permissions on ${targets.length} path(s)`;
    }

    throw new Error('nothing to repair here');
  },
  run: (): CheckOutcome => {
    const dir = configDir();
    const settingsFile = path.join(dir, 'settings.json');
    const evidence: Record<string, unknown> = { dir };

    if (!fs.existsSync(dir)) {
      try {
        fs.accessSync(os.homedir(), fs.constants.W_OK);
        return {
          detail: `${dir} does not exist yet; it will be created on first write.`,
          evidence,
          status: 'ok',
        };
      } catch {
        return {
          detail: `${dir} does not exist and ${os.homedir()} is not writable.`,
          evidence,
          fix: 'Point the CLI at a writable home with LOBEHUB_CLI_HOME.',
          status: 'fail',
        };
      }
    }

    try {
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      return {
        detail: `${dir} is not writable.`,
        evidence,
        fix: `chmod u+w ${dir}, or set LOBEHUB_CLI_HOME to a writable directory.`,
        status: 'fail',
      };
    }

    const loose = loosePermissions([dir, settingsFile, credentialsPath()]);
    evidence.loosePermissions = loose;

    if (fs.existsSync(settingsFile)) {
      let raw: string;
      try {
        raw = fs.readFileSync(settingsFile, 'utf8');
      } catch (error) {
        // Unreadable is not corrupt: the file may be perfectly valid, so it is
        // not offered to --fix, which would move it aside unparsed.
        return {
          detail: `${settingsFile} cannot be read: ${error instanceof Error ? error.message : String(error)}.`,
          evidence,
          fix: `chmod u+r ${settingsFile}`,
          status: 'fail',
        };
      }

      try {
        JSON.parse(raw);
      } catch {
        return {
          detail: `${settingsFile} is not valid JSON, so every custom URL in it is being ignored.`,
          evidence: { ...evidence, repairable: 'settings' },
          fix: `Delete it and run 'lh login' again, or re-run with --fix to move it aside.`,
          status: 'fail',
        };
      }
    }

    if (loose.length > 0)
      return {
        detail: `${dir} is usable, but ${loose.length} file(s) are readable by other users.`,
        evidence: { ...evidence, repairable: 'permissions' },
        fix: `chmod go-rwx ${loose.join(' ')}`,
        status: 'warn',
      };

    return { detail: `${dir} is writable and private.`, evidence, status: 'ok' };
  },
  title: 'cli home',
};

function loosePermissions(paths: string[]): string[] {
  if (process.platform === 'win32') return [];
  return paths.filter((target) => {
    try {
      return (fs.statSync(target).mode & 0o077) !== 0;
    } catch {
      return false;
    }
  });
}

/**
 * Disk, not because the CLI needs much, but because everything it drives does:
 * a full disk shows up as unrelated pull/extract failures much further down.
 */
const diskSpace: DoctorCheck = {
  group: 'runtime',
  id: 'runtime.disk',
  profiles: ['core'],
  run: (): CheckOutcome => {
    const tmp = os.tmpdir();
    const evidence: Record<string, unknown> = { tmp };

    try {
      const probe = path.join(tmp, `lh-doctor-${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
    } catch (error) {
      return {
        detail: `${tmp} is not writable: ${error instanceof Error ? error.message : String(error)}.`,
        evidence,
        fix: 'Set TMPDIR to a writable directory.',
        status: 'fail',
      };
    }

    let free: number | undefined;
    try {
      const stats = fs.statfsSync(os.homedir());
      free = stats.bavail * stats.bsize;
    } catch {
      return {
        detail: `${tmp} is writable; free space is unknown on this platform.`,
        evidence,
        status: 'ok',
      };
    }

    evidence.freeBytes = free;

    if (free < 512 * 1024 ** 2)
      return {
        detail: `Only ${bytesToGb(free)} free on ${os.homedir()}.`,
        evidence,
        fix: 'Free up space — downloads, image pulls and log writes fail in confusing ways below ~0.5 GB.',
        status: 'fail',
      };

    if (free < 5 * 1024 ** 3)
      return {
        detail: `${bytesToGb(free)} free on ${os.homedir()}.`,
        evidence,
        fix: 'Consider freeing space before long runs.',
        status: 'warn',
      };

    return { detail: `${bytesToGb(free)} free, ${tmp} writable.`, evidence, status: 'ok' };
  },
  title: 'disk & tmp',
};

/** A newer published CLI is a warning, never a failure. */
const cliUpToDate: DoctorCheck = {
  // The runner's budget must outlast the internal deadline for every
  // `--timeout`, or a stalled registry surfaces as a runner failure instead
  // of the warning this check reports.
  budgetMs: (options) => options.timeoutMs + 1000,
  group: 'runtime',
  id: 'runtime.latest',
  network: true,
  profiles: ['core'],
  run: async (ctx): Promise<CheckOutcome> => {
    let latest: string;
    try {
      // Bound the request here rather than letting the runner's timeout fire:
      // that would surface as `fail` (and a non-zero exit) for what this check
      // has decided is only ever a warning.
      let timer: NodeJS.Timeout | undefined;
      try {
        latest = await Promise.race([
          fetchLatestVersion(cliPackageName, 'latest'),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(`the npm registry did not answer within ${ctx.options.timeoutMs}ms`),
                ),
              ctx.options.timeoutMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return {
        detail: `Could not reach the npm registry: ${error instanceof Error ? error.message : String(error)}.`,
        fix: 'Only affects the update check; ignore it on an air-gapped machine.',
        status: 'warn',
      };
    }

    if (isNewerVersion(latest, cliVersion))
      return {
        detail: `${cliVersion} installed, ${latest} published.`,
        evidence: { installed: cliVersion, latest },
        fix: 'lh update',
        status: 'warn',
      };

    return {
      detail: `${cliVersion} is the latest published version.`,
      evidence: { installed: cliVersion, latest },
      status: 'ok',
    };
  },
  title: 'cli version',
};

export const runtimeChecks: readonly DoctorCheck[] = [
  nodeVersion,
  cliInstall,
  cliHome,
  diskSpace,
  cliUpToDate,
];
