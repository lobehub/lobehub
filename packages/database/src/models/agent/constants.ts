import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

/** Slugs owned by builtin provisioning; user input must never set one. */
export const RESERVED_AGENT_SLUGS: ReadonlySet<string> = new Set<string>(
  Object.values(BUILTIN_AGENT_SLUGS),
);
