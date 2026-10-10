import { type AgentItem } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

export interface BuiltinAgentParams {
  /** Builtin agent slug (`inbox`, `page-agent`, the builders, …). */
  slug: string;
}

/**
 * One builtin agent per slug, keyed by its slug.
 *
 * The server provisions the row on first read (`agent.getBuiltinAgent`) and
 * returns the whole `AgentItem`. Persisted so a reload can restore both the
 * slug → id mapping (`builtinAgentIdMap`) and the config the surface paints with
 * (inbox identity / artwork) before the network answers, then revalidate in the
 * background — the same first-frame the SWR `builtinAgent:init` entry used to
 * provide.
 */
export const builtinAgentResource = defineReplica<BuiltinAgentParams, AgentItem>({
  key: ({ slug }) => slug,
  name: 'builtinAgent',
  storage: 'indexedDB',
  version: 1,
});
