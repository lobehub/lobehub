import { isRecord } from '@lobechat/utils/object';

import type { ThreadStartParams } from './protocol';

/** These values identify a run; credentials and all other settings remain process-scoped. */
const sessionEnvKeys = ['LOBEHUB_AGENT_ID', 'LOBEHUB_OPERATION_ID', 'LOBEHUB_TOPIC_ID'];

/**
 * Copies the environment without request provenance.
 *
 * Before:
 * - { CODEX_HOME: "/codex", LOBEHUB_OPERATION_ID: "run-a" }
 *
 * After:
 * - { CODEX_HOME: "/codex" }
 *
 * Use when:
 * - Starting or comparing a shared Codex app-server process.
 *
 * Expects:
 * - The caller's environment is not mutated.
 *
 * Returns:
 * - All defined process settings, including credentials, with only the three run IDs omitted.
 */
export const getCodexProcessEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const processEnv = { ...env };
  for (const key of Object.keys(processEnv)) {
    if (sessionEnvKeys.includes(key) || processEnv[key] === undefined) delete processEnv[key];
  }
  return processEnv;
};

/**
 * Adds run provenance to the shell environment of one Codex thread.
 *
 * Use when:
 * - Starting or resuming a thread in a shared app-server.
 *
 * Expects:
 * - Existing thread config remains intact; process credentials are not copied into RPC payloads.
 *
 * Returns:
 * - A new config with exact run IDs; missing IDs are empty so saved config cannot revive stale IDs.
 */
export const withCodexThreadEnv = (
  params: ThreadStartParams,
  env: Partial<NodeJS.ProcessEnv>,
): ThreadStartParams => {
  const provenance = Object.fromEntries(sessionEnvKeys.map((key) => [key, env[key] ?? '']));
  const config = { ...params.config };
  // Config accepts both object and dotted-key forms. Keep provenance identical in each
  // form so applying an ancestor override cannot restore an earlier run's IDs.
  const policy = config.shell_environment_policy;
  if (isRecord(policy)) {
    config.shell_environment_policy = {
      ...policy,
      set: { ...(isRecord(policy.set) ? policy.set : {}), ...provenance },
    };
  }
  const set = config['shell_environment_policy.set'];
  if (isRecord(set)) config['shell_environment_policy.set'] = { ...set, ...provenance };
  for (const key of sessionEnvKeys) config[`shell_environment_policy.set.${key}`] = provenance[key];
  return { ...params, config };
};
