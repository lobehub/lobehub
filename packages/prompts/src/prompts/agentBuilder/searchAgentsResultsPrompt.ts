import type { HeterogeneousProviderConfig } from '@lobechat/types';

import { escapeXmlAttr, escapeXmlContent } from '../search/xmlEscape';

export type SearchAgentSource = 'user' | 'market' | 'all';

export interface SearchAgentResultItem {
  /** Short description of what the agent does. */
  description?: string;
  /**
   * Heterogeneous agent runtime type, set only when this agent delegates
   * execution to an external CLI/device runtime (e.g. `claude-code`, `codex`).
   * Absent for normal model-runtime agents.
   */
  heteroType?: HeterogeneousProviderConfig['type'];
  id: string;
  /** Whether the agent comes from the marketplace (vs. the user's workspace). */
  isMarket?: boolean;
  title?: string;
}

export interface SearchAgentsPromptInput {
  agents: SearchAgentResultItem[];
  /** Whether more workspace agents exist beyond the returned page. */
  hasMore?: boolean;
  /** Real count of marketplace matches across all pages. */
  marketTotal?: number;
  /** Max results allowed per call — used to warn when the request was capped. */
  maxLimit?: number;
  /** Number of workspace agents skipped for this page. */
  offset?: number;
  /** The limit the caller requested (to warn when it exceeds `maxLimit`). */
  requestedLimit?: number;
  source: SearchAgentSource;
  /** Real count of workspace matches across all pages. */
  userTotal?: number;
}

const formatAgent = (agent: SearchAgentResultItem): string => {
  const attrs: string[] = [
    `id="${escapeXmlAttr(agent.id)}"`,
    `title="${escapeXmlAttr(agent.title || 'Untitled')}"`,
    `origin="${agent.isMarket ? 'market' : 'workspace'}"`,
  ];

  if (agent.heteroType) attrs.push(`heteroType="${escapeXmlAttr(agent.heteroType)}"`);

  const attrString = attrs.join(' ');
  const content = agent.description ? escapeXmlContent(agent.description) : '';

  return content ? `<agent ${attrString}>${content}</agent>` : `<agent ${attrString} />`;
};

/**
 * Build a search result for the agent-management `searchAgent` tool.
 *
 * The outer summary is a plain sentence; each agent is rendered as a compact
 * `<agent>` XML element to raise semantic density — surfacing its `origin`
 * (workspace vs. market) and, for heterogeneous agents, the `heteroType` so the
 * supervisor can tell at a glance that a result (e.g. a Claude Code machine) can
 * directly execute a handed-off task. Pagination / cap hints follow as plain
 * `Note:` lines after a blank line.
 *
 * @example
 * ```text
 * Found 1 agent in your workspace, showing 1-1:
 * <agent id="agt_xxx" title="CC 2号机" origin="workspace" heteroType="claude-code">My CC machine</agent>
 *
 * Note: Agents with a `heteroType` are heterogeneous agents backed by an external CLI/device runtime. They can execute coding / agentic tasks directly — hand a task to them without extra setup.
 * ```
 */
export const searchAgentsResultsPrompt = (input: SearchAgentsPromptInput): string => {
  const {
    agents,
    source,
    userTotal = 0,
    marketTotal = 0,
    offset = 0,
    hasMore = false,
    requestedLimit,
    maxLimit,
  } = input;

  const shown = agents.length;
  const plural = (n: number) => (n === 1 ? 'agent' : 'agents');

  let headline: string;
  if (shown === 0) {
    const totalCount = userTotal + marketTotal;
    headline =
      totalCount === 0
        ? 'No agents matched. Try different keywords, or create a new agent.'
        : `No agents at offset ${offset}; only ${totalCount} match. Retry with a smaller offset.`;
  } else if (source === 'market') {
    headline = `Found ${marketTotal} ${plural(marketTotal)} in the marketplace, showing the first ${shown}:`;
  } else if (source === 'all') {
    headline = `Found ${userTotal} ${plural(userTotal)} in your workspace and ${marketTotal} in the marketplace, showing ${shown}:`;
  } else {
    headline = `Found ${userTotal} ${plural(userTotal)} in your workspace, showing ${offset + 1}-${offset + shown}:`;
  }

  const lines = [headline, ...agents.map(formatAgent)];

  const notes: string[] = [];

  if (agents.some((a) => a.heteroType)) {
    notes.push(
      'Agents with a `heteroType` are heterogeneous agents backed by an external CLI/device runtime (e.g. claude-code, codex). They can execute coding / agentic tasks directly — you can hand a task to such an agent without further setup.',
    );
  }

  if (requestedLimit && maxLimit && requestedLimit > maxLimit) {
    notes.push(
      `Requested limit ${requestedLimit} exceeds the maximum of ${maxLimit}; results were capped at ${maxLimit} per call.`,
    );
  }

  if (hasMore) {
    const shownUserCount = agents.filter((a) => !a.isMarket).length;
    notes.push(
      `More workspace agents available: call searchAgent with offset=${offset + shownUserCount}${source === 'all' ? ' and source="user"' : ''} to get the next page.`,
    );
  }

  const body = lines.join('\n');
  const noteBlock = notes.map((note) => `Note: ${note}`).join('\n');

  return noteBlock ? `${body}\n\n${noteBlock}` : body;
};
