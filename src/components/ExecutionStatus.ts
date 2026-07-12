import type { ChatTopicStatus, TaskStatus } from '@lobechat/types';
import { cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CirclePause,
  CircleSlash,
  CircleX,
  Clock,
  HandIcon,
  StarIcon,
  TriangleAlert,
} from 'lucide-react';

export interface ExecutionStatusVisual {
  color: string;
  icon: LucideIcon;
}

/**
 * Canonical glyph + color per execution-status semantic, shared by tasks and
 * topics (sidebar rows, group headers, kanban columns, management table, fleet
 * sidebar). One semantic → one visual, so the same state never renders with
 * different icons across surfaces. Live "running" rows may still swap the
 * static glyph for the animated `RingLoadingIcon` — same circle family and
 * warning color, animation just signals liveness.
 */
const VISUALS = {
  archived: { color: cssVar.colorTextDescription, icon: Archive },
  backlog: { color: cssVar.colorTextQuaternary, icon: CircleDashed },
  canceled: { color: cssVar.colorTextSecondary, icon: CircleSlash },
  completed: { color: cssVar.colorSuccess, icon: CircleCheck },
  failed: { color: cssVar.colorError, icon: CircleX },
  idle: { color: cssVar.colorTextTertiary, icon: Circle },
  paused: { color: cssVar.colorTextDescription, icon: CirclePause },
  running: { color: cssVar.colorWarning, icon: CircleDot },
  scheduled: { color: cssVar.colorWarning, icon: Clock },
  waitingForHuman: { color: cssVar.colorInfo, icon: HandIcon },
} satisfies Record<string, ExecutionStatusVisual>;

export const TASK_STATUS_VISUALS: Record<TaskStatus, ExecutionStatusVisual> = {
  backlog: VISUALS.backlog,
  canceled: VISUALS.canceled,
  completed: VISUALS.completed,
  failed: VISUALS.failed,
  // Task `paused` is surfaced as "Pending review" — same semantic as a topic
  // waiting for human input, so it shares the hand glyph.
  paused: VISUALS.waitingForHuman,
  running: VISUALS.running,
  scheduled: VISUALS.scheduled,
};

export const TOPIC_STATUS_VISUALS: Record<ChatTopicStatus, ExecutionStatusVisual> = {
  active: VISUALS.idle,
  archived: VISUALS.archived,
  // Topic lists are mostly history: mute completed to keep long lists quiet,
  // unlike task boards where a green check marks an achievement.
  completed: { ...VISUALS.completed, color: cssVar.colorTextDescription },
  // A failed topic is an alert the user should act on, not a terminal outcome
  // like a failed task run — the warning triangle reads that way, the circled X
  // reads as "closed/rejected".
  failed: { ...VISUALS.failed, icon: TriangleAlert },
  paused: VISUALS.paused,
  running: VISUALS.running,
  scheduled: VISUALS.scheduled,
  // `unread` rows render a custom ripple dot; this is the fallback glyph.
  unread: { color: cssVar.colorInfo, icon: CircleDot },
  waitingForHuman: VISUALS.waitingForHuman,
};

/**
 * Synthetic sidebar group buckets that don't map 1:1 to a persisted status:
 * `favorite` is split out by `buildGroupedTopics`; `pending` collapses the
 * attention-needing states (waiting for human / failed / unread) and borrows
 * the waiting-for-human glyph since "needs your attention" is its semantic.
 */
export const TOPIC_GROUP_VISUALS = {
  favorite: { color: cssVar.colorTextTertiary, icon: StarIcon },
  pending: VISUALS.waitingForHuman,
} satisfies Record<string, ExecutionStatusVisual>;

export const EXECUTION_STATUS_VISUALS = VISUALS;
