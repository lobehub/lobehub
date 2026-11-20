import { stripInheritedRunIdentity } from '@lobechat/heterogeneous-agents/protocol';

// Anthropic auth env vars that must NOT be inherited from the desktop process
// when spawning a local CLI agent. A developer with `ANTHROPIC_API_KEY` (or an
// auth token / base url) exported in their shell would otherwise have it
// forwarded to `claude`, which then switches from its own subscription login to
// that key — an expired / wrong key surfaces as a baffling "Invalid API key"
// and the run exits non-zero. Agents that genuinely want an API key still set
// it through `session.env`, which is spread AFTER the inherited env below and
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

/** Keep loopback traffic (the local MCP server) off any configured proxy. */
export const appendLoopbackNoProxy = (env: NodeJS.ProcessEnv): void => {
  const entries = new Set([
    ...[env.NO_PROXY, env.no_proxy]
      .filter((value): value is string => !!value)
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean),
    '127.0.0.1',
    'localhost',
  ]);
  const noProxy = [...entries].join(',');
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
};
