/**
 * Every string that names the product, in one place.
 *
 * These were previously literals scattered across a dozen modules — the bin
 * names in `utils/completion.ts`, the config directory in five separate files,
 * the systemd unit name defined twice, the product name in a handful of
 * descriptions and one agent-facing prompt. That worked while there was exactly
 * one distribution, but it meant a white-label build had no seam: the strings
 * are reached at runtime from paths no UI gating can intercept, and one of them
 * (`buildNotifyProtocol`) is a prompt the model repeats back to the user.
 *
 * The values below are upstream's, unchanged, so the default build is
 * byte-identical. A distribution replaces this module wholesale.
 */

/** Product name as it appears inside sentences. */
export const CLI_PRODUCT_NAME = 'LobeHub';

/** The CLI's own name, e.g. in `--help` and the connect banner. */
export const CLI_DISPLAY_NAME = 'LobeHub CLI';

/**
 * The command users type. Also the man page's title (uppercased) and the name
 * shown in "run `<bin> login`" hints.
 */
export const CLI_PRIMARY_BIN = 'lh';

/** Additional command names installed alongside the primary one. */
export const CLI_BIN_ALIASES: readonly string[] = ['lobe', 'lobehub'];

/** Every installed command name — what shell completion has to bind to. */
export const CLI_BIN_NAMES: readonly string[] = [CLI_PRIMARY_BIN, ...CLI_BIN_ALIASES];

/**
 * Shell function name emitted by `completion`.
 *
 * A shell identifier, so it must stay `[A-Za-z_][A-Za-z0-9_]*` — a distribution
 * overriding this cannot use hyphens or spaces.
 */
export const CLI_COMPLETION_FUNCTION = '_lobehub_completion';

/** Directory under $HOME holding settings, credentials and daemon state. */
export const CLI_CONFIG_DIR_NAME = '.lobehub';

/**
 * Env var the generated completion script uses to hand `__complete` the
 * current word index.
 *
 * Purely internal plumbing: the completion function sets it and the CLI reads
 * it back within the same invocation, so a user never sets or sees it
 * directly — unlike `CLI_API_KEY_ENV_NAMES`, there is no back-compat concern
 * for a rebranded distribution, since both sides always come from the one
 * binary running. Still collected here rather than left as a literal in
 * `utils/completion.ts`/`commands/completion.ts`: it is one of the strings
 * this module's doc comment above promises are all in one place, and it was
 * the one that got missed the first time around.
 */
export const CLI_COMPLETION_CWORD_ENV = 'LOBEHUB_COMP_CWORD';

/** systemd unit name for `connect service`. */
export const CLI_CONNECT_SERVICE_NAME = 'lobehub-connect.service';

/**
 * Environment variable names the user may set, most preferred first.
 *
 * A list rather than a single name so a rebranded distribution can introduce
 * its own prefix while still honouring anything already exported in a user's
 * shell or CI config. Only variables the USER sets belong here — the ones the
 * desktop app and the server inject (LOBEHUB_SERVER, LOBEHUB_JWT, the agent-run
 * ids) are a cross-process contract and must be renamed on both sides at once.
 */
export const CLI_API_KEY_ENV_NAMES: readonly string[] = ['LOBEHUB_CLI_API_KEY'];
export const CLI_HOME_ENV_NAMES: readonly string[] = ['LOBEHUB_CLI_HOME'];

const firstEnvValue = (names: readonly string[]): string | undefined => {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
};

/** API key from the environment, honouring every accepted variable name. */
export const readCliApiKeyEnv = (): string | undefined => firstEnvValue(CLI_API_KEY_ENV_NAMES);

/** Config directory name, overridable per-install by the home env var. */
export const resolveCliDirName = (): string =>
  firstEnvValue(CLI_HOME_ENV_NAMES) ?? CLI_CONFIG_DIR_NAME;
