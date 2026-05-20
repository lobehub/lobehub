import { log } from '../../utils/logger';

interface AgentLookupClient {
  agent: {
    getBuiltinAgent: {
      query: (input: { slug: string }) => Promise<{ agentId?: string; id?: string } | null>;
    };
  };
}

/**
 * Resolve an agent identifier into a concrete agent id.
 *
 * Use when:
 * - A command accepts either a positional agent id or `--slug`.
 * - Downstream tRPC calls require the concrete agent id.
 *
 * Expects:
 * - `opts.agentId` to win over `opts.slug`.
 * - `client.agent.getBuiltinAgent` to resolve slugs when needed.
 *
 * Returns:
 * - The resolved agent id, or exits the process after logging a CLI-facing error.
 */
export async function resolveAgentId(
  client: AgentLookupClient,
  opts: { agentId?: string; slug?: string },
): Promise<string> {
  if (opts.agentId) return opts.agentId;

  if (opts.slug) {
    const agent = await client.agent.getBuiltinAgent.query({ slug: opts.slug });
    if (!agent) {
      log.error(`Agent not found for slug: ${opts.slug}`);
      process.exit(1);
    }

    return agent.id || agent.agentId || '';
  }

  log.error('Either <agentId> or --slug is required.');
  process.exit(1);
  return '';
}
