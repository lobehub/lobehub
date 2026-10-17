import { exec } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { getCliWrapperDir } from '@/modules/cliEmbedding';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';

const logger = createLogger('controllers:CliCtr');

function normalizeServerUrl(url: string): string {
  return url.replace(/\/$/, '');
}

/** The names the embedded CLI answers to, all of which the shim must cover. */
const CLI_ALIASES = ['lh', 'lobe', 'lobehub'] as const;

const shellSingleQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

/** One shim per alias, in the platform's own script format. */
const writeCliShims = (dir: string, vars: Record<string, string>) => {
  for (const alias of CLI_ALIASES) {
    if (process.platform === 'win32') {
      // `setlocal` keeps the variables inside this batch file; the PowerShell
      // or cmd that called `lh` never sees them.
      const content = [
        '@echo off',
        'setlocal',
        ...Object.entries(vars).map(([key, value]) => `set "${key}=${value}"`),
        `call ${alias} %*`,
        'exit /b %ERRORLEVEL%',
      ].join('\r\n');
      writeFileSync(path.join(dir, `${alias}.cmd`), content, { mode: 0o700 });
    } else {
      const content = [
        '#!/bin/sh',
        ...Object.entries(vars).map(([key, value]) => `${key}=${shellSingleQuote(value)}`),
        `export ${Object.keys(vars).join(' ')}`,
        `exec ${alias} "$@"`,
      ].join('\n');
      const file = path.join(dir, alias);
      writeFileSync(file, content, { mode: 0o700 });
      chmodSync(file, 0o700);
    }
  }
};

export default class CliCtr extends ControllerModule {
  static override readonly groupName = 'cli';

  /**
   * Environment for running the embedded CLI: the caller's own variables, the
   * wrapper directory first on `PATH` (so `lh` / `lobe` / `lobehub` resolve to
   * the bundled CLI rather than whatever else is installed), and — when the
   * app is signed in — the credentials the CLI authenticates with.
   *
   * Returned as overrides layered on top of `process.env` by the runner.
   */
  async buildCliEnv(baseEnv: Record<string, string> = {}): Promise<Record<string, string>> {
    const env = this.withCliOnPath(baseEnv);

    const credentials = await this.getCliCredentials();
    if (credentials) {
      Object.assign(env, credentials);
      logger.debug('Injected LOBEHUB_JWT / LOBEHUB_SERVER for CLI command');
    }

    return env;
  }

  /**
   * Environment for a command that reaches the CLI later in its text — `echo
   * …; lh …`, `if lh …`, a loop, `$(lh …)`.
   *
   * Unlike {@link buildCliEnv}, the credentials are NOT exported to the
   * command's shell: whatever else it runs — `npm install && lh …` runs the
   * install first — would inherit them. They live in a per-command `lh` /
   * `lobe` / `lobehub` shim first on `PATH`, which sets them only for the CLI
   * it execs, the same shape as the cloud sandbox's wrapper
   * (`preprocessLhCommand`). Call `dispose` once the command has exited to
   * delete the shim, and the token with it.
   */
  async buildIndirectCliEnv(
    baseEnv: Record<string, string> = {},
  ): Promise<{ dispose: () => void; env: Record<string, string> }> {
    const env = this.withCliOnPath(baseEnv);

    const credentials = await this.getCliCredentials();
    if (!credentials) return { dispose: () => {}, env };

    const pathKey = this.pathKeyFor(baseEnv);
    // mkdtemp creates the directory 0700, so only this user can list or read it.
    const dir = mkdtempSync(path.join(tmpdir(), 'lobehub-lh-shim-'));
    // The shim drops its own directory from PATH before exec, so the alias it
    // runs is the bundled CLI (or whatever `lh` was next), never itself.
    writeCliShims(dir, { ...credentials, [pathKey]: env[pathKey] });
    env[pathKey] = `${dir}${path.delimiter}${env[pathKey]}`;

    return { dispose: () => rmSync(dir, { force: true, recursive: true }), env };
  }

  /**
   * Windows spells it `Path`, and a second, differently-cased key next to it
   * would leave which one the child sees up to chance — reuse the existing key.
   */
  private pathKeyFor(baseEnv: Record<string, string>): string {
    return (
      Object.keys(baseEnv).find((key) => key.toUpperCase() === 'PATH') ??
      Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ??
      'PATH'
    );
  }

  private withCliOnPath(baseEnv: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = { ...baseEnv };
    const pathKey = this.pathKeyFor(baseEnv);
    const currentPath = baseEnv[pathKey] ?? process.env[pathKey];
    env[pathKey] = currentPath
      ? `${getCliWrapperDir()}${path.delimiter}${currentPath}`
      : getCliWrapperDir();
    return env;
  }

  /** The signed-in session's token and server, or nothing when signed out. */
  private async getCliCredentials(): Promise<
    { LOBEHUB_JWT: string; LOBEHUB_SERVER: string } | undefined
  > {
    const remoteCtr = this.app.getController(RemoteServerConfigCtr);
    if (!remoteCtr) return;

    const [token, serverUrl] = await Promise.all([
      remoteCtr.getAccessToken(),
      remoteCtr.getRemoteServerUrl(),
    ]);
    if (!token || !serverUrl) return;

    return { LOBEHUB_JWT: token, LOBEHUB_SERVER: normalizeServerUrl(serverUrl) };
  }

  /**
   * Quick CLI invocation for the settings page's "test CLI" box. Agent
   * `runCommand` calls do not come through here — they run in the regular
   * command runner (see `ShellCommandCtr.handleRunCommand`).
   */
  @IpcMethod()
  async runCliCommand(args: string): Promise<{ exitCode: number; stderr: string; stdout: string }> {
    const execAsync = promisify(exec);
    const wrapperDir = getCliWrapperDir();
    const cmd = process.platform === 'win32' ? 'lobehub.cmd' : 'lobehub';
    const wrapperPath = path.join(wrapperDir, cmd);

    const env = { ...process.env, ...(await this.buildCliEnv()) };

    try {
      const { stdout, stderr } = await execAsync(`"${wrapperPath}" ${args}`, {
        env,
        timeout: 15_000,
      });
      return { exitCode: 0, stderr, stdout };
    } catch (error: any) {
      return {
        exitCode: error.code ?? 1,
        stderr: error.stderr ?? '',
        stdout: error.stdout ?? String(error.message),
      };
    }
  }
}
