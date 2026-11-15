import { stripInheritedRunIdentity } from '@lobechat/heterogeneous-agents/protocol';

// Anthropic auth env vars that must NOT be inherited from the desktop process
// when spawning a local CLI agent. A developer with `ANTHROPIC_API_KEY` (or an
// auth token / base url) exported in their shell would otherwise have it
// forwarded to `claude`, which then switches from its own subscription login to
// that key — an expired / wrong key surfaces as a baffling "Invalid API key"
// and the run exits non-zero. Agents that genuinely want an API key still set
// it through their own env, which is spread AFTER the inherited env and
// therefore wins.
const STRIPPED_INHERITED_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
] as const;

/**
 * Inherited `process.env` without the Anthropic auth vars or an ancestor agent run's
 * identity (a Desktop launched from an agent shell carries its JWT file, which the CLI
 * prefers over any token). Pure and exported so the invariant is unit-tested directly.
 */
export const buildInheritedSpawnEnv = (
  sourceEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const env = stripInheritedRunIdentity(sourceEnv);
  for (const key of STRIPPED_INHERITED_ENV_KEYS) delete env[key];
  return env;
};
