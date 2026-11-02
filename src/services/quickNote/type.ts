import type {
  QuickNoteAnalyzeTrigger,
  QuickNoteDelegatePreset,
  QuickNoteProposalDecisionStatus,
  QuickNoteProposalKind,
  QuickNoteProposalPayload,
  QuickNoteProposalValidity,
  QuickNoteResourceRole,
  QuickNoteResourceType,
  QuickNoteRunDecision,
  QuickNoteRunExecutionConfig,
  QuickNoteRunKind,
} from '@lobechat/types';

/** Latest AI summary of a Quick Note, projected from its newest Run that wrote one. */
export interface QuickNoteSummary {
  /** Completion time of the Run that produced the summary, in milliseconds. */
  completedAt: number;
  content: string;
}

/** Codes a user can pick when dismissing a Proposal; stored as the dismissal reason. */
export const QUICK_NOTE_DISMISS_REASONS = ['not_now', 'not_wanted', 'duplicate', 'other'] as const;

/** A dismissal reason code. */
export type QuickNoteDismissReason = (typeof QUICK_NOTE_DISMISS_REASONS)[number];

/** A Task this note started (applied `task` Proposal or Dive), listed in the note sidebar. */
export interface QuickNoteTask {
  /** Creation timestamp in milliseconds. */
  createdAt: number;
  id: string;
  /** Human-readable identifier used by the task detail route, such as `T-12`. */
  identifier: string;
  name?: string | null;
  /** The applied Proposal, absent for Dive. */
  proposalId: string | null;
  runId: string | null;
  status: string;
  /** Last-update timestamp in milliseconds. */
  updatedAt: number;
}

/** User feedback attached to one Quick Note and consumed by later Runs. */
export interface QuickNoteComment {
  /** Current plain-text projection. */
  content: string;
  /** Creation timestamp in milliseconds. */
  createdAt: number;
  /** Optional rich-text source for the current revision. */
  editorData?: Record<string, unknown> | null;
  /** Stable Comment identifier. */
  id: string;
  /** Last-edit timestamp in milliseconds. */
  updatedAt: number;
}

/** Editable Agent suggestion that can become a downstream product object. */
export interface QuickNoteProposal {
  /** Creation timestamp in milliseconds. */
  createdAt: number;
  /** When the user decided, in milliseconds. */
  decidedAt?: number | null;
  /** The user's terminal or pending decision. */
  decisionStatus: QuickNoteProposalDecisionStatus;
  /** Optional user-supplied dismissal reason. */
  dismissReason?: string | null;
  /** Stable Proposal identifier. */
  id: string;
  /** Product object family created after acceptance. */
  kind: QuickNoteProposalKind;
  /** The AI draft of `payload`. */
  originalPayload: QuickNoteProposalPayload;
  /** Full arguments of the target action, including user edits. */
  payload: QuickNoteProposalPayload;
  /** Built-in `delegate` preset that produced the Proposal. */
  preset?: QuickNoteDelegatePreset | null;
  /** Identifier of the object produced by applying the Proposal. */
  resultId?: string | null;
  /** Product object family produced by applying the Proposal: `task`, `topic`, `goal` or `page`. */
  resultType?: string | null;
  /** Last-edit timestamp in milliseconds. */
  updatedAt: number;
  /** Whether the Proposal still matches the current Quick Note revision. */
  validity: QuickNoteProposalValidity;
}

/** Current typed product resource selected as useful Quick Note context. */
export interface QuickNoteResource {
  /** Agent that owns a Topic or Conversation and can hydrate its native drawer. */
  agentId?: string | null;
  /** Creation timestamp in milliseconds. */
  createdAt: number;
  /** Stable Resource Link identifier. */
  id: string;
  /** Best available human-readable product label. */
  label?: string | null;
  /** Stable identifier in the referenced domain. */
  resourceId: string;
  /** Canonical product object family. */
  resourceType: QuickNoteResourceType;
  /** Meaning of the link for the current source revision. */
  role: QuickNoteResourceRole;
  /** Run that linked the resource; absent for user-supplied links. */
  runId?: string | null;
  /** Optional native selection, such as a quoted message range. */
  selector?: Record<string, unknown> | null;
  /** Task identifier used by the task detail route when applicable. */
  taskIdentifier?: string | null;
  taskStatus?: string | null;
}

/** Agent-owned sidecar data shown beside a Quick Note source Document. */
export interface QuickNoteAgenticDetails {
  /** User feedback available to the next Agent Run. */
  comments: QuickNoteComment[];
  /** Agent suggestions waiting for or retaining a user decision. */
  proposals: QuickNoteProposal[];
  /** Context links accepted for the current source revision. */
  resources: QuickNoteResource[];
}

export interface QuickNoteItem {
  /** Time when the current saved revision becomes eligible for Automatic Analysis. */
  analyzeDueAt?: number;
  collection?: string;
  content: string;
  createdAt: number;
  documentId?: string;
  editorData?: Record<string, unknown>;
  id: string;
  location?: string;
  run?: {
    agentId?: string | null;
    /** When the Run reached a terminal status, in milliseconds. */
    completedAt?: number | null;
    /** Intent judgement of the Run, when it produced one. */
    decision?: QuickNoteRunDecision | null;
    executionConfig?: QuickNoteRunExecutionConfig | null;
    kind: QuickNoteRunKind;
    operationId?: string | null;
    status: 'canceled' | 'completed' | 'failed' | 'pending' | 'running' | 'superseded';
    /** Topic created by the Run's agent operation. */
    topicId?: string | null;
    trigger?: QuickNoteAnalyzeTrigger | null;
  };
  /** Latest AI summary; absent until a Run writes one. */
  summary?: QuickNoteSummary;
  tags: string[];
  updatedAt: number;
}
