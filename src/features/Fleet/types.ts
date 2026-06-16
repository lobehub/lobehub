import { type ConversationContext } from '@lobechat/types';

/**
 * A single side-by-side column in the Fleet View. Each column maps to one
 * agent + topic conversation (typically a running task's current topic).
 *
 * `fallbackTitle` is captured when the column is opened so the header still
 * renders a sensible label after the task leaves the running list.
 */
export interface FleetColumn {
  agentId: string;
  fallbackTitle: string;
  key: string;
  taskIdentifier?: string;
  threadId: string | null;
  topicId: string | null;
  /** Topic working directory (CC session cwd / repo), for the column subtitle. */
  workingDirectory?: string | null;
}

/** Number of horizontal bands the board stacks columns into (vertical tiers). */
export type FleetRows = 1 | 2;

/** Stable, content-derived key so a given agent+topic always maps to one column. */
export const fleetColumnKey = (agentId: string, topicId: string | null | undefined) =>
  `${agentId}::${topicId ?? 'default'}`;

export const toConversationContext = (column: FleetColumn): ConversationContext => ({
  agentId: column.agentId,
  scope: 'main',
  threadId: column.threadId,
  topicId: column.topicId,
});

export const DEFAULT_COLUMN_WIDTH = 420;
export const MIN_COLUMN_WIDTH = 320;
export const MAX_COLUMN_WIDTH = 720;
