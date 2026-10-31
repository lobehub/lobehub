export interface AgentLikeStat {
  /** Whether the current user has liked the agent. */
  liked: boolean;
  total: number;
}

/** Like stats keyed by agent id; agents without likes are absent. */
export type AgentLikeSummaries = Record<string, AgentLikeStat>;
