import { getHeterogeneousTypeLabel } from '@lobechat/heterogeneous-agents';

export interface AgentRuntime {
  /**
   * Runtime label of an external agent (Claude Code, Codex, …); absent for a
   * built-in agent, or while it is not yet known which of the two it is.
   */
  heterogeneousLabel?: string;
  /** Whether the card knows enough to label the agent at all. */
  known: boolean;
}

/**
 * Which runtime an agent card describes.
 *
 * An external agent runs on its own CLI with its own model choice, so the
 * LobeHub model on its config says nothing about what does the work — the card
 * names the runtime instead. The home agent list answers instantly for agents
 * in the sidebar; the fetched config covers the rest. Until one of them has
 * answered, the agent is labelled neither way rather than guessed "built-in".
 */
export const resolveAgentRuntime = ({
  fetchedType,
  isFetched,
  listEntry,
}: {
  fetchedType?: string | null;
  isFetched: boolean;
  listEntry?: { heterogeneousType?: string | null } | null;
}): AgentRuntime => {
  const type = listEntry?.heterogeneousType ?? fetchedType;
  const heterogeneousLabel = getHeterogeneousTypeLabel(type);
  return { heterogeneousLabel, known: !!heterogeneousLabel || !!listEntry || isFetched };
};
