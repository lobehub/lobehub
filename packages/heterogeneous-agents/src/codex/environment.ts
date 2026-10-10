import { isRecord } from '@lobechat/utils/object';

import type { ThreadStartParams } from './protocol';

/** These values identify one run; credentials and every other setting stay process-scoped. */
const CODEX_PROVENANCE_KEYS = [
  'LOBEHUB_AGENT_ID',
  'LOBEHUB_OPERATION_ID',
  'LOBEHUB_TOPIC_ID',
] as const;

const isProvenanceKey = (key: string) => (CODEX_PROVENANCE_KEYS as readonly string[]).includes(key);

export type CodexRunProvenance = Partial<Record<(typeof CODEX_PROVENANCE_KEYS)[number], string>>;

/** Picks only the run provenance from a launch environment. */
export const pickCodexRunProvenance = (env: NodeJS.ProcessEnv): CodexRunProvenance =>
  Object.fromEntries(CODEX_PROVENANCE_KEYS.map((key) => [key, env[key]]));

/**
 * Environment for the shared app-server process: defined values only, without run provenance,
 * so neither reuse checks nor a reconnect can carry the first run's IDs. MCP servers that Codex
 * spawns inherit this environment, so only shell tools receive provenance.
 */
export const getCodexProcessEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const processEnv = { ...env };
  for (const key of Object.keys(processEnv)) {
    if (isProvenanceKey(key) || processEnv[key] === undefined) delete processEnv[key];
  }
  return processEnv;
};

const SHELL_POLICY_KEY = 'shell_environment_policy';

/**
 * Sets run provenance in a thread's shell environment. Missing IDs become empty strings, so
 * config saved with the thread cannot revive an earlier run's values.
 */
export const withCodexThreadEnv = (
  params: ThreadStartParams,
  provenance: CodexRunProvenance,
): ThreadStartParams => {
  const config = { ...params.config };
  // Codex applies request overrides in hash-map order and an ancestor table replaces earlier
  // descendants, so user `-c shell_environment_policy...` overrides are folded into one table.
  const policy = isRecord(config[SHELL_POLICY_KEY])
    ? structuredClone(config[SHELL_POLICY_KEY])
    : {};
  delete config[SHELL_POLICY_KEY];
  for (const key of Object.keys(config)) {
    if (!key.startsWith(`${SHELL_POLICY_KEY}.`)) continue;
    const path = key.slice(SHELL_POLICY_KEY.length + 1).split('.');
    let target = policy;
    for (const segment of path.slice(0, -1)) {
      if (!isRecord(target[segment])) target[segment] = {};
      target = target[segment] as typeof target;
    }
    target[path.at(-1)!] = config[key];
    delete config[key];
  }
  policy.set = {
    ...(isRecord(policy.set) ? policy.set : {}),
    ...Object.fromEntries(CODEX_PROVENANCE_KEYS.map((key) => [key, provenance[key] ?? ''])),
  };
  config[SHELL_POLICY_KEY] = policy;
  return { ...params, config };
};

/** Whether two runs would give the thread's shell the same IDs. */
export const isSameCodexRunProvenance = (a: CodexRunProvenance, b: CodexRunProvenance) =>
  CODEX_PROVENANCE_KEYS.every((key) => (a[key] ?? '') === (b[key] ?? ''));
