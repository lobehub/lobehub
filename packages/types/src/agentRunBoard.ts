import type { ChatTopicMetadata } from './topic';

/** Lets the viewer's own live run reattach to its stream when opened. */
export type AgentRunBoardRunningOperation = NonNullable<ChatTopicMetadata['runningOperation']>;

export const AGENT_RUN_BOARD_WINDOW_HOURS = [1, 6, 24] as const;

/** `involved`: runs the viewer started, spoke in, or is asked to approve. */
export const AGENT_RUN_BOARD_SCOPES = ['all', 'involved'] as const;

export type AgentRunBoardScope = (typeof AGENT_RUN_BOARD_SCOPES)[number];

export type AgentRunBoardWindowHours = (typeof AGENT_RUN_BOARD_WINDOW_HOURS)[number];

export type AgentRunBoardRunStatus = 'done' | 'failed' | 'needs_human' | 'running' | 'stopped';

export interface AgentRunBoardRun {
  /** Null while the run is live; the bar then extends to `generatedAt`. */
  endedAt: Date | null;
  id: string;
  model: string | null;
  runningOperation: AgentRunBoardRunningOperation | null;
  startedAt: Date;
  status: AgentRunBoardRunStatus;
  /** Task or topic title, matching the conversation a click opens. Null until one exists. */
  title: string | null;
  topicId: string | null;
  trigger: string | null;
  userId: string;
  /** When a run that needs a person began waiting; it was running until then. */
  waitingSince: Date | null;
}

export interface AgentRunBoardLane {
  agentId: string;
  avatar: string | null;
  backgroundColor: string | null;
  /** The member the agent belongs to. */
  ownerUserId: string;
  runs: AgentRunBoardRun[];
  title: string | null;
}

export interface AgentRunBoardAttentionItem {
  agentAvatar: string | null;
  agentBackgroundColor: string | null;
  agentId: string;
  agentTitle: string | null;
  /** Failure message. */
  detail: string | null;
  /** Whether the viewer is the member who can act on this item. */
  isMine: boolean;
  kind: 'failed' | 'needs_human';
  operationId: string;
  /** The member who can approve, or who started the failed run. */
  ownerUserId: string;
  runningOperation: AgentRunBoardRunningOperation | null;
  /** When the wait began or the run failed. */
  since: Date;
  title: string | null;
  topicId: string | null;
}

export interface AgentRunBoardSummary {
  done: number;
  failed: number;
  needsHuman: number;
  running: number;
}

/** Runs that started in one slice of the window, counted by their current status. */
export interface AgentRunBoardActivityBucket extends AgentRunBoardSummary {
  startedAt: Date;
}

/** What the board can be narrowed to, independent of the current agent and member picks. */
export interface AgentRunBoardFilterOptions {
  agents: { id: string; title: string | null }[];
  memberIds: string[];
}

export interface AgentRunBoardData {
  activity: AgentRunBoardActivityBucket[];
  attention: AgentRunBoardAttentionItem[];
  filterOptions: AgentRunBoardFilterOptions;
  generatedAt: Date;
  /** Active agents left out of `lanes` by the lane cap. */
  hiddenLaneCount: number;
  lanes: AgentRunBoardLane[];
  summary: AgentRunBoardSummary;
  windowStart: Date;
}
