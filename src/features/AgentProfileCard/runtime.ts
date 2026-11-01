import { getHeterogeneousTypeLabel } from '@lobechat/heterogeneous-agents';

/**
 * Runtime label of an external agent (Claude Code, Codex, …), or `undefined`
 * for a built-in agent and while it is not yet known which of the two it is.
 *
 * An external agent runs on its own CLI with its own model choice, so the
 * LobeHub model on its config says nothing about what does the work — the card
 * names the runtime instead. The home agent list answers instantly for agents
 * in the sidebar; the fetched config covers the rest.
 */
export const resolveAgentRuntimeLabel = ({
  fetchedType,
  listEntry,
}: {
  fetchedType?: string | null;
  listEntry?: { heterogeneousType?: string | null } | null;
}): string | undefined => getHeterogeneousTypeLabel(listEntry?.heterogeneousType ?? fetchedType);
