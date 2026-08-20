import type { Command } from 'commander';
import pc from 'picocolors';

import { CLI_COMMAND_MODE_ENV_NAMES, CLI_PRIMARY_BIN } from '../constants/identity';
import { loadSettings, resolveCommandMode, saveSettings } from '../settings';
import { COMMAND_MODES, DEFAULT_COMMAND_MODE, parseCommandMode } from '../settings/commandMode';
import { probeSandbox } from '../tools/shell';
import { log } from '../utils/logger';

const CONFIG_KEYS = ['command-mode', 'sandbox-network'] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number];

const isConfigKey = (value: string): value is ConfigKey =>
  (CONFIG_KEYS as readonly string[]).includes(value);

const parseBoolean = (value: string): boolean | undefined => {
  if (['1', 'on', 'true', 'yes'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
  return undefined;
};

const unknownKey = (key: string) => {
  log.error(`Unknown config key: ${key}. Known keys: ${CONFIG_KEYS.join(', ')}.`);
  process.exitCode = 1;
};

/**
 * Report the effective value *and* where it came from.
 *
 * Not decoration. `command-mode` has three inputs (stored file, environment,
 * and later a server push-down) and they combine by taking the strictest rather
 * than the last — so "what did I set" and "what is in force" genuinely differ,
 * and an operator debugging a refused command needs to be told which one they
 * are looking at.
 */
const describeCommandMode = () => {
  const stored = parseCommandMode(loadSettings()?.commandMode);
  const effective = resolveCommandMode();

  const sources: string[] = [];
  if (stored) sources.push(`stored: ${stored}`);
  for (const name of CLI_COMMAND_MODE_ENV_NAMES) {
    const value = process.env[name]?.trim();
    if (value) sources.push(`${name}: ${value}`);
  }
  if (sources.length === 0) sources.push(`default: ${DEFAULT_COMMAND_MODE}`);

  return { effective, note: sources.join(', ') };
};

export function registerCliConfigCommand(program: Command) {
  const configCmd = program
    .command('config')
    .description('Read and write this device’s local configuration');

  configCmd
    .command('list', { isDefault: true })
    .description('Show the effective configuration and where each value comes from')
    .action(() => {
      const mode = describeCommandMode();
      const sandboxNetwork = loadSettings()?.sandboxNetwork === true;

      console.log(pc.bold('Device configuration'));
      console.log(`  command-mode      ${mode.effective}  ${pc.dim(`(${mode.note})`)}`);
      console.log(
        `  sandbox-network   ${sandboxNetwork}  ${pc.dim('(applies only to a fence this device imposes)')}`,
      );
      console.log();
      console.log(pc.dim(`  auto     honour what each run asks for (default)`));
      console.log(pc.dim(`  sandbox  fence every command, even one that did not ask`));
      console.log(pc.dim(`  host     run on the host; refuse any run that requires a fence`));
    });

  configCmd
    .command('get <key>')
    .description(`Print one value (${CONFIG_KEYS.join(', ')})`)
    .action((key: string) => {
      if (!isConfigKey(key)) return unknownKey(key);

      if (key === 'command-mode') {
        console.log(describeCommandMode().effective);
        return;
      }
      console.log(String(loadSettings()?.sandboxNetwork === true));
    });

  configCmd
    .command('set <key> <value>')
    .description('Store a value on this device')
    .action(async (key: string, value: string) => {
      if (!isConfigKey(key)) return unknownKey(key);
      const settings = loadSettings() ?? {};

      if (key === 'command-mode') {
        const mode = parseCommandMode(value);
        if (!mode) {
          log.error(
            `Invalid command mode: ${value}. Expected one of: ${COMMAND_MODES.join(', ')}.`,
          );
          process.exitCode = 1;
          return;
        }

        saveSettings({ ...settings, commandMode: mode });

        // Say so now rather than letting every command fail later. This does
        // not block the write: provisioning the sandbox and configuring the
        // device are legitimately separate steps, and refusing to record the
        // intent would force them into one order.
        if (mode === 'sandbox') {
          const capability = await probeSandbox();
          if (!capability.available) {
            log.warn(
              `Saved, but this device cannot run sandboxed commands yet: ${capability.reason ?? 'unsupported host'}. Commands will be refused until that is resolved.`,
            );
          }
        }

        const effective = resolveCommandMode();
        log.info(`command-mode = ${mode}`);
        if (effective !== mode) {
          log.warn(
            `In force: ${effective} — the environment (${CLI_COMMAND_MODE_ENV_NAMES.join(', ')}) is stricter and wins.`,
          );
        }
        log.info(`Run '${CLI_PRIMARY_BIN} connect restart' for a running daemon to pick this up.`);
        return;
      }

      const parsed = parseBoolean(value);
      if (parsed === undefined) {
        log.error(`Invalid boolean: ${value}. Expected true or false.`);
        process.exitCode = 1;
        return;
      }
      saveSettings({ ...settings, sandboxNetwork: parsed });
      log.info(`sandbox-network = ${parsed}`);
    });

  configCmd
    .command('unset <key>')
    .description('Remove a stored value, falling back to the default')
    .action((key: string) => {
      if (!isConfigKey(key)) return unknownKey(key);
      const settings = loadSettings() ?? {};

      if (key === 'command-mode') {
        saveSettings({ ...settings, commandMode: undefined });
        log.info(`command-mode cleared (default: ${DEFAULT_COMMAND_MODE})`);
        return;
      }

      saveSettings({ ...settings, sandboxNetwork: undefined });
      log.info('sandbox-network cleared (default: false)');
    });
}
