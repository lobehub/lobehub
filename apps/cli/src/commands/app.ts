import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import {
  type DesktopChannel,
  type DesktopAppLocation,
  installShim,
  isDesktopChannel,
  launchDesktopApp,
  resolveDesktopApp,
  schemeFor,
  uninstallShim,
} from '../utils/desktopApp';
import { outputJson } from '../utils/format';
import { log } from '../utils/logger';

interface AppCommandOptions {
  channel?: string;
  dryRun?: boolean;
  installCli?: boolean;
  json?: boolean | string;
  newWindow?: boolean;
  scheme?: boolean;
  uninstallCli?: boolean;
}

/**
 * Canonicalize the directory a launch should open.
 *
 * Resolving here, in the invoking shell's process, is what makes the feature
 * work at all: the app itself may be started by launchd with `/` as its
 * working directory, so a relative `.` would mean nothing by the time it is
 * read on the other side.
 */
export const resolveLaunchDirectory = (input = '.'): null | string => {
  const absolute = path.resolve(input);
  if (!existsSync(absolute)) return null;
  if (!statSync(absolute).isDirectory()) return null;
  try {
    return realpathSync(absolute);
  } catch {
    return null;
  }
};

const describeMissingApp = (channel?: DesktopChannel): string => {
  const where = channel ? `${channel} channel of ` : '';
  return [
    `No ${where}LobeHub Desktop installation was found.`,
    '',
    '  Install the desktop app, or point at a build explicitly:',
    `    ${pc.bold('LOBEHUB_DESKTOP_PATH=/path/to/LobeHub.app')} lh app .`,
    '',
    `  Check what is installed: ${pc.bold('lh app --scheme')}`,
  ].join('\n');
};

const runInstallCli = (location: DesktopAppLocation, options: AppCommandOptions) => {
  const result = installShim(location);

  if (options.json !== undefined) {
    return outputJson({ ...result, executablePath: location.executablePath }, options.json);
  }

  if (!result.written) {
    log.error(`Refusing to overwrite ${result.path} — it was not written by LobeHub.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Installed ${pc.bold(result.path)} → ${pc.dim(location.executablePath)}`);
  console.log(`\nNow run ${pc.bold('lobehub .')} to open a directory.`);
  if (!(process.env.PATH ?? '').split(path.delimiter).includes(path.dirname(result.path))) {
    console.log(
      pc.yellow(`\n  Note: ${path.dirname(result.path)} is not on your PATH.`),
      `\n  Add it in your shell profile to use the command from anywhere.`,
    );
  }
};

export function registerAppCommand(program: Command) {
  program
    .command('app [path]')
    .description('Open a directory in LobeHub Desktop (like `code .`)')
    .option('-n, --new-window', 'Start a new conversation instead of revealing the existing one')
    .option('--channel <channel>', 'Which installed build to use (stable, beta, nightly)')
    .option('--scheme', 'Print the deep-link scheme of the installed build')
    .option('--install-cli', 'Install the `lobehub` shell command')
    .option('--uninstall-cli', 'Remove the `lobehub` shell command')
    .option('--dry-run', 'Print what would be launched without starting it')
    .option('--json [fields]', 'Output JSON')
    .action(async (pathArg: string | undefined, options: AppCommandOptions) => {
      const channel =
        options.channel && isDesktopChannel(options.channel) ? options.channel : undefined;

      if (options.channel && !channel) {
        log.error(`Unknown channel "${options.channel}". Use stable, beta, or nightly.`);
        process.exitCode = 1;
        return;
      }

      if (options.uninstallCli) {
        const removed = uninstallShim();
        if (options.json !== undefined) return outputJson({ removed }, options.json);
        console.log(removed ? 'Removed the `lobehub` command.' : 'No `lobehub` command to remove.');
        return;
      }

      const location = resolveDesktopApp(channel);
      if (!location) {
        log.error(describeMissingApp(channel));
        process.exitCode = 1;
        return;
      }

      if (options.installCli) return runInstallCli(location, options);

      if (options.scheme) {
        if (options.json !== undefined)
          return outputJson(
            {
              channel: location.channel,
              executablePath: location.executablePath,
              scheme: schemeFor(location),
            },
            options.json,
          );
        console.log(schemeFor(location));
        return;
      }

      // `.` is the default so `lh app` and `lh app .` mean the same thing.
      const target = pathArg ?? '.';
      const directory = resolveLaunchDirectory(target);
      if (!directory) {
        log.error(`Not a directory: ${target}`);
        process.exitCode = 1;
        return;
      }

      // Positional, like `code .`: Electron reorders argv (switches first,
      // positionals last), which detaches a flag from its value. A bare
      // directory always survives that reordering.
      const args = [directory];
      if (options.newWindow) args.push('--new-window');

      if (options.dryRun) {
        if (options.json !== undefined)
          return outputJson(
            { args, channel: location.channel, executablePath: location.executablePath },
            options.json,
          );
        console.log(`${location.executablePath} ${args.join(' ')}`);
        return;
      }

      await launchDesktopApp(location, args);

      if (options.json !== undefined)
        return outputJson({ channel: location.channel, opened: directory }, options.json);
      log.info(`Opened ${pc.bold(directory)} in LobeHub Desktop`);
    });
}
