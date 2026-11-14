import debug from 'debug';
import pMap from 'p-map';

import type { SandboxProvider } from './types';

const log = debug('lobe-server:sandbox:creds-env');

/**
 * Market's inject endpoint rewrites `~/.creds/env` with only the keys of the
 * current call, so the listing lost every variable an earlier injection had
 * recorded (the variables themselves stay in the process env). After each
 * injection this command folds the new file into a ledger of everything
 * injected into this sandbox and writes the union back to `~/.creds/env`.
 *
 * Lines are keyed by variable name, whether written as `NAME=…`,
 * `export NAME=…` or the masked `# NAME=…` comment form, and the latest
 * line for a name wins. Other lines are kept once, in first-seen order.
 *
 * Market masks the listing's comment lines but keeps the first and last two
 * characters (`# NAME=po******db`). Those fragments are still part of the
 * value, so comment lines are rewritten to `# NAME=******`. Assignment lines
 * (`NAME=…`, `export NAME=…`) are left as written because a shell may source
 * them. The command carries no credential names or values, and it prints
 * nothing.
 */
export const CREDS_ENV_MERGE_COMMAND = [
  'umask 077',
  'mkdir -p ~/.creds',
  'touch ~/.creds/env ~/.creds/.env.ledger',
  `awk '
function varname(line,  n) {
  n = line
  sub(/^#[ \\t]*/, "", n)
  sub(/^export[ \\t]+/, "", n)
  if (n !~ /^[A-Za-z_][A-Za-z0-9_]*=/) return ""
  sub(/=.*/, "", n)
  return n
}
{
  k = varname($0)
  if (k == "") {
    if (!(("L" $0) in seen)) { seen["L" $0] = 1; order[++count] = "L" $0 }
    next
  }
  if (!(("V" k) in seen)) { seen["V" k] = 1; order[++count] = "V" k }
  latest[k] = ($0 ~ /^#/) ? "# " k "=******" : $0
}
END {
  for (i = 1; i <= count; i++) {
    entry = order[i]
    if (substr(entry, 1, 1) == "V") print latest[substr(entry, 2)]
    else print substr(entry, 2)
  }
}' ~/.creds/.env.ledger ~/.creds/env > ~/.creds/.env.merged`,
  'cp ~/.creds/.env.merged ~/.creds/.env.ledger',
  'mv ~/.creds/.env.merged ~/.creds/env',
].join(' && ');

/**
 * Best effort: the credentials are already in the sandbox when this runs, so
 * a failed merge only leaves the listing as Market wrote it.
 */
export const mergeCredsEnvListing = async (
  provider: Pick<SandboxProvider, 'callTool'>,
): Promise<boolean> => {
  try {
    const result = await provider.callTool('runCommand', { command: CREDS_ENV_MERGE_COMMAND });
    if (!result.success) {
      log('merge ~/.creds/env failed: %s', result.error?.message);
      return false;
    }
    return true;
  } catch (error) {
    log('merge ~/.creds/env threw: %O', error);
    return false;
  }
};

interface InjectResultLike {
  credentials?: { env?: Record<string, string> };
  notFound?: string[];
  unsupportedInSandbox?: string[];
}

/**
 * Market returns one flat `credentials.env` map per call, so a call that
 * injects several keys does not say which key set which variable. A single
 * key needs no lookup. For several keys this asks Market again per key with
 * `sandbox: false`, which resolves the credential without touching the
 * sandbox, and keeps only the variable names. On failure it returns
 * `undefined` and the result lists the variables as unattributed.
 */
export const resolveInjectedEnvVarsByKey = async (
  keys: string[],
  result: InjectResultLike,
  injectWithoutSandbox: (key: string) => Promise<InjectResultLike>,
): Promise<Record<string, string[]> | undefined> => {
  const skipped = new Set([...(result.notFound ?? []), ...(result.unsupportedInSandbox ?? [])]);
  const injected = [...new Set(keys)].filter((key) => !skipped.has(key));
  const envNames = Object.keys(result.credentials?.env ?? {});

  if (injected.length === 0 || envNames.length === 0) return undefined;
  if (injected.length === 1) return { [injected[0]]: envNames };

  try {
    const injectedNames = new Set(envNames);
    const entries = await pMap(
      injected,
      async (key) => {
        const single = await injectWithoutSandbox(key);
        const names = Object.keys(single.credentials?.env ?? {}).filter((name) =>
          injectedNames.has(name),
        );
        return [key, names] as const;
      },
      { concurrency: 4 },
    );
    return Object.fromEntries(entries);
  } catch (error) {
    log('resolve env names per key failed: %O', error);
    return undefined;
  }
};
