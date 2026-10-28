import type { EnvironmentConfiguration } from '@lobechat/types';

/** Long enough for a shallow clone and a dependency install. */
export const SANDBOX_ENVIRONMENT_INIT_TIMEOUT_MS = 600_000;

/**
 * Where a sandbox records the folders it initialized: under its home, never in
 * the folder — the folder holds only what the repository and setup put there.
 */
export const SANDBOX_ENVIRONMENT_STATE_DIR = '.lobe/environments';

/** Printed first by a run that did something, so a no-op is told apart without parsing. */
export const SANDBOX_ENVIRONMENT_RAN_LINE = '__lobe_environment_ran';

/**
 * What a working directory is initialized from: an environment's repository
 * and setup, plus the variables both of them — and every command the
 * conversation runs afterwards — see. Nothing is tracked once it has run, in
 * the database or in the folder.
 */
export interface SandboxInitialization {
  bootstrapCommand?: string;
  /**
   * A header git sends for one URL prefix, so a private repository clones: a
   * short-lived, repository-scoped token from the GitHub App installation, as
   * a build used to get. Resolved per run and never stored.
   */
  cloneCredential?: { header: string; urlPrefix: string };
  env?: Record<string, string>;
  environmentId: string;
  name: string;
  sources: { path?: string; ref?: string; url: string }[];
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

const ENV_NAME = /^[A-Z_]\w*$/i;

/**
 * The initialization an environment asks for, or `undefined` when it asks for
 * nothing — no repository, no setup and no variables — so picking an empty
 * definition runs nothing. One that only declares variables is kept: they are
 * exported into every command, even with nothing to clone or set up.
 *
 * Only git sources: a `files` source belongs to the release before folders on
 * the drive replaced it, and has no meaning in a folder that already is one.
 */
export const toSandboxInitialization = (environment: {
  configuration?: EnvironmentConfiguration | null;
  id: string;
  name: string;
}): SandboxInitialization | undefined => {
  const configuration = environment.configuration ?? {};
  const sources = (configuration.sources ?? []).flatMap((source) =>
    source.kind === 'git' && source.url
      ? [
          {
            url: source.url,
            ...(source.ref && { ref: source.ref }),
            ...(source.path && { path: source.path }),
          },
        ]
      : [],
  );
  const bootstrapCommand = configuration.bootstrapCommand?.trim() || undefined;
  const env =
    configuration.env && Object.keys(configuration.env).length > 0 ? configuration.env : undefined;
  if (sources.length === 0 && !bootstrapCommand && !env) return undefined;

  return {
    environmentId: environment.id,
    name: environment.name,
    sources,
    ...(bootstrapCommand && { bootstrapCommand }),
    ...(env && { env }),
  };
};

/** Whether applying the environment does anything to the folder: a clone or a setup to run. */
export const hasEnvironmentInitWork = (init: SandboxInitialization): boolean =>
  init.sources.length > 0 || !!init.bootstrapCommand;

const toExports = (env: Record<string, string> | undefined): string[] =>
  Object.entries(env ?? {})
    .filter(([key]) => ENV_NAME.test(key))
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`);

/**
 * A conversation's shell command with the environment's variables exported in
 * front of it.
 *
 * Every tool call starts a fresh shell, so the variables are put in front of
 * each command rather than set once: a value exported by the initializer, or
 * by an earlier call, is gone by the next one. In front, so the command can
 * still override one for itself. The command is unchanged when the
 * environment declares none.
 */
export const withEnvironmentVariables = (
  command: string,
  env: Record<string, string> | undefined,
): string => {
  const exports = toExports(env);
  if (exports.length === 0) return command;

  return `${exports.join('\n')}\n${command}`;
};

/** A destination inside the working directory, or `undefined` for a path that would leave it. */
const safeDestination = (path: string | undefined): string | undefined => {
  const value = (path ?? '.').trim() || '.';
  if (value.startsWith('/') || value.split('/').includes('..')) return undefined;

  return value;
};

/**
 * One idempotent shell command that applies an environment to the current
 * directory: clone each repository, then run setup.
 *
 * Nothing is written into the folder to say it was initialized. An empty
 * folder is initialized; a folder that holds anything is left alone, silently:
 * either an earlier run filled it, or it holds someone's work that a clone
 * would mix with and setup does not expect.
 *
 * Each run is also recorded in the sandbox itself, outside the folder, keyed
 * by the folder and the environment: a setup that installs globally writes
 * nothing into the folder, and without the record it would rerun on every
 * tool call, as each one starts a fresh service. A failed run is recorded too,
 * so it is not retried on every call either. The record goes with the
 * sandbox — and so do global installs — so a new sandbox initializes again.
 *
 * The variables are exported in a subshell, so they reach clone and setup
 * here; the commands the conversation runs afterwards get them from
 * {@link withEnvironmentVariables}, not from this shell.
 */
export const buildSandboxEnvironmentInitCommand = (init: SandboxInitialization): string => {
  const label = shellQuote(init.name);

  const exports = toExports(init.env);

  const clones = init.sources.map((source, index) => {
    const destination = safeDestination(source.path);
    if (!destination)
      return `echo ${shellQuote(`Skipped a repository with an unusable path: ${source.path}`)}`;

    const branch = source.ref ? ` --branch ${shellQuote(source.ref)}` : '';
    const url = shellQuote(source.url);
    // Cloned beside the directory and copied in, so a second repository can
    // land in a sub-path of a directory the first one already filled; the
    // checkout's own `.git` comes along.
    const staging = `"$__lobe_tmp/${index}"`;

    return [
      `git clone --depth 1${branch} ${url} ${staging}`,
      `mkdir -p ${shellQuote(destination)}`,
      `cp -a ${staging}/. ${shellQuote(destination)}/`,
    ].join(' && ');
  });

  // Given to git through its environment for the clones alone, and unset
  // before setup runs: nothing writes it to disk or into the checkout's
  // `.git/config`, and setup — or a command after it — cannot read it back.
  const credential =
    init.cloneCredential && clones.length > 0
      ? {
          set: [
            `export GIT_CONFIG_COUNT=1`,
            `export GIT_CONFIG_KEY_0=${shellQuote(`http.${init.cloneCredential.urlPrefix}.extraHeader`)}`,
            `export GIT_CONFIG_VALUE_0=${shellQuote(init.cloneCredential.header)}`,
          ],
          unset: [`unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0`],
        }
      : { set: [], unset: [] };

  // Only when there is something to clone, and removed however the subshell
  // ends: a second copy of every repository would otherwise stay in the
  // sandbox, one more for each failed attempt.
  const staging =
    clones.length > 0 ? [`__lobe_tmp="$(mktemp -d)"`, `trap 'rm -rf "$__lobe_tmp"' EXIT`] : [];

  const steps = [
    ...exports,
    ...staging,
    ...credential.set,
    ...clones,
    ...credential.unset,
    ...(init.bootstrapCommand ? [init.bootstrapCommand] : []),
  ];

  // Joined with `&&` inside one subshell, so the first failure stops what
  // follows and its status is the subshell's.
  const body = `( set -e; ${steps.join(' && ')} )`;

  const record = `"\${HOME:-/tmp}/${SANDBOX_ENVIRONMENT_STATE_DIR}"`;
  const key = `"$(printf '%s|%s' "$PWD" ${shellQuote(init.environmentId)} | cksum | cut -d ' ' -f 1)"`;

  return [
    `__lobe_state=${record}/${key}`,
    `if [ ! -e "$__lobe_state" ] && [ -z "$(ls -A . 2>/dev/null)" ]; then`,
    `  echo ${SANDBOX_ENVIRONMENT_RAN_LINE}`,
    `  mkdir -p ${record}`,
    `  if ${body}; then`,
    `    echo done > "$__lobe_state"`,
    `    echo "Initialized from the environment "${label}"."`,
    `  else`,
    `    __lobe_status=$?`,
    `    echo failed > "$__lobe_state"`,
    `    echo "Initializing from the environment "${label}" failed (exit $__lobe_status)."`,
    `  fi`,
    `fi`,
  ].join('\n');
};

/** Whether the command's output says it ran, rather than finding the folder initialized. */
export const environmentInitRan = (stdout: string | undefined): boolean =>
  !!stdout && stdout.split('\n').some((line) => line.trim() === SANDBOX_ENVIRONMENT_RAN_LINE);

/** The run's own output, without the line that only says it ran. */
export const environmentInitReport = (stdout: string | undefined): string =>
  (stdout ?? '')
    .split('\n')
    .filter((line) => line.trim() !== SANDBOX_ENVIRONMENT_RAN_LINE)
    .join('\n')
    .trim();
