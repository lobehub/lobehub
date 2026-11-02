import type { SidebarAgentItem } from '@lobechat/types';

/** Select value standing for "no configured agent": the builtin Quick Note analyzer. */
export const BUILTIN_ANALYZER_VALUE = '__quick-note-analyze__';

export interface AnalyzerAgentOption {
  label: string;
  value: string;
}

/**
 * Builds the analyze-agent choices: the builtin analyzer first, then the user's own agents.
 *
 * Use when:
 * - The Quick Note analyze settings list which agent runs the analysis.
 *
 * Expects:
 * - `agents` is the shared sidebar agent list (pinned, grouped, ungrouped, private), which may
 *   contain chat groups and the same agent more than once.
 * - Agents driven by an external CLI cannot run a server-side analysis, so they are left out.
 *
 * Before:
 * - `[{ id: "a", title: "Writer", type: "agent" }, { id: "g", type: "group" }]`
 *
 * After:
 * - `[{ label: "Built-in", value: "__quick-note-analyze__" }, { label: "Writer", value: "a" }]`
 */
export const buildAnalyzerAgentOptions = (
  agents: Pick<SidebarAgentItem, 'heterogeneousType' | 'id' | 'title' | 'type'>[],
  builtinLabel: string,
): AnalyzerAgentOption[] => {
  const seen = new Set<string>();
  const options: AnalyzerAgentOption[] = [{ label: builtinLabel, value: BUILTIN_ANALYZER_VALUE }];

  for (const agent of agents) {
    if (agent.type !== 'agent' || agent.heterogeneousType || seen.has(agent.id)) continue;
    seen.add(agent.id);
    options.push({ label: agent.title?.trim() || agent.id, value: agent.id });
  }

  return options;
};
