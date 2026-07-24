export type AgentGroupBy = 'author' | 'none';
export type AgentOrderBy = 'author' | 'title' | 'updatedAt';
export type AgentOrderDirection = 'asc' | 'desc';

export interface AgentListViewOptions {
  groupBy: AgentGroupBy;
  orderBy: AgentOrderBy;
  orderDirection: AgentOrderDirection;
  /** Whether agents hidden from the sidebar still appear on this page. */
  showSidebarHidden: boolean;
}

export const DEFAULT_AGENT_LIST_VIEW_OPTIONS: AgentListViewOptions = {
  groupBy: 'none',
  orderBy: 'updatedAt',
  orderDirection: 'desc',
  showSidebarHidden: true,
};

const AGENT_GROUP_BY_SET = new Set<AgentGroupBy>(['author', 'none']);
const AGENT_ORDER_BY_SET = new Set<AgentOrderBy>(['author', 'title', 'updatedAt']);
const AGENT_ORDER_DIRECTION_SET = new Set<AgentOrderDirection>(['asc', 'desc']);

export const normalizeAgentListViewOptions = (
  value?: Partial<AgentListViewOptions> | null,
): AgentListViewOptions => {
  const next = value ?? {};
  return {
    groupBy: AGENT_GROUP_BY_SET.has(next.groupBy as AgentGroupBy)
      ? (next.groupBy as AgentGroupBy)
      : DEFAULT_AGENT_LIST_VIEW_OPTIONS.groupBy,
    orderBy: AGENT_ORDER_BY_SET.has(next.orderBy as AgentOrderBy)
      ? (next.orderBy as AgentOrderBy)
      : DEFAULT_AGENT_LIST_VIEW_OPTIONS.orderBy,
    orderDirection: AGENT_ORDER_DIRECTION_SET.has(next.orderDirection as AgentOrderDirection)
      ? (next.orderDirection as AgentOrderDirection)
      : DEFAULT_AGENT_LIST_VIEW_OPTIONS.orderDirection,
    showSidebarHidden:
      typeof next.showSidebarHidden === 'boolean'
        ? next.showSidebarHidden
        : DEFAULT_AGENT_LIST_VIEW_OPTIONS.showSidebarHidden,
  };
};
