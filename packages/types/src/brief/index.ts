import type { TaskStatus } from '../task';

export interface BriefAction {
  /** Action identifier, e.g. 'approve', 'reject', 'feedback' */
  key: string;
  /** Display label, e.g. "✅ Confirm Start", "💬 Revisions" */
  label: string;
  /**
   * Action type:
   * - 'resolve': directly mark brief as resolved
   * - 'comment': prompt for text input, then resolve
   * - 'link': navigate to a URL (no resolution)
   */
  type: 'resolve' | 'comment' | 'link';
  /** URL for 'link' type actions */
  url?: string;
}

/**
 * Default actions by brief type.
 *
 * Note: `result` briefs intentionally have no defaults — they are terminal and
 * render a fixed single-button UI (approve → completes the task). Custom
 * actions on result briefs are dropped at creation time.
 */
export const DEFAULT_BRIEF_ACTIONS: Record<string, BriefAction[]> = {
  decision: [
    { key: 'approve', label: '✅ Confirm', type: 'resolve' },
    { key: 'feedback', label: '💬 Request changes', type: 'comment' },
  ],
  error: [
    { key: 'retry', label: '🔄 Retry', type: 'resolve' },
    { key: 'feedback', label: '💬 Feedback', type: 'comment' },
  ],
  insight: [{ key: 'acknowledge', label: '👍 Acknowledged', type: 'resolve' }],
};

/** Brief type — must match DEFAULT_BRIEF_ACTIONS keys and DB schema comment */
export type BriefType = 'decision' | 'error' | 'insight' | 'result';

/**
 * Brief types with nothing to decide — the home "news" digest. Shared between
 * the server day-feed query and the client feed split so the two can never
 * disagree on what counts as news.
 */
export const NEWS_BRIEF_TYPES: BriefType[] = ['insight', 'result'];

/**
 * A single artifact (currently only documents) referenced from a brief.
 * Programmatically collected during topic completion, not produced by the LLM.
 */
export interface BriefArtifactDocument {
  id: string;
  kind: string | null;
  title: string | null;
}

export interface BriefArtifacts {
  documents?: BriefArtifactDocument[];
}

/** Agent Signal-owned Brief metadata namespace. */
export interface BriefAgentSignalMetadata {
  /** Future Agent Signal domains can extend this namespace without top-level collisions. */
  [key: string]: unknown;
  /** Nightly self-review state written by Agent Signal maintenance runs. */
  nightlySelfReview?: unknown;
}

/** Freeform Brief metadata namespaced by feature owner. */
export interface BriefMetadata {
  /** Other feature namespaces remain possible without schema churn. */
  [key: string]: unknown;
  /** Agent Signal extension metadata. */
  agentSignal?: BriefAgentSignalMetadata;
}

export interface AgentAvatarInfo {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  /** Personal name; renderers resolve the label with `agentDisplayName(agent, fallback)`. */
  name?: string | null;
  title: string | null;
}

/** Enriched unresolved Brief view returned to the client Home surface. */
export interface BriefItem {
  actions: BriefAction[] | null;
  agent: AgentAvatarInfo | null;
  agentId: string | null;
  artifacts: BriefArtifacts | null;
  createdAt: Date | string;
  cronJobId: string | null;
  id: string;
  priority: string | null;
  readAt: Date | string | null;
  resolvedAction: string | null;
  resolvedAt: Date | string | null;
  resolvedComment: string | null;
  summary: string;
  taskId: string | null;
  /** Parent task's workspace-scoped ref (`T-12`). Populated by server enrichment; absent on locally-constructed BriefItems. */
  taskIdentifier?: string | null;
  taskName?: string | null;
  /** Parent task's runtime status — `scheduled` means the task is parked between automated runs and approving the brief should NOT complete it. Populated by server enrichment; optional on locally-constructed BriefItems (e.g. from activity rows). */
  taskStatus?: TaskStatus | null;
  title: string;
  topicId: string | null;
  type: BriefType;
  userId: string;
}
