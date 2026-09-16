import type {
  QuickNoteAnalyzeTrigger,
  QuickNoteProposalDecisionStatus,
  QuickNoteProposalKind,
  QuickNoteProposalValidity,
  QuickNoteResourceRole,
  QuickNoteResourceType,
  QuickNoteRunExecutionConfig,
} from '@lobechat/types';

export interface QuickNoteAnnotation {
  content: string;
  divedAt?: number;
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
  /** Current plain-text Proposal body. */
  content: string;
  /** Creation timestamp in milliseconds. */
  createdAt: number;
  /** The user's terminal or pending decision. */
  decisionStatus: QuickNoteProposalDecisionStatus;
  /** Optional rich-text source for the current Proposal version. */
  editorData?: Record<string, unknown> | null;
  /** Stable Proposal identifier. */
  id: string;
  /** Product object family created after acceptance. */
  kind: QuickNoteProposalKind;
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
  annotation?: QuickNoteAnnotation;
  collection?: string;
  content: string;
  createdAt: number;
  documentId?: string;
  editorData?: Record<string, unknown>;
  id: string;
  location?: string;
  run?: {
    agentId?: string | null;
    executionConfig?: QuickNoteRunExecutionConfig | null;
    kind: 'analyze' | 'dive' | 'signal_enrichment';
    operationId?: string | null;
    status: 'canceled' | 'completed' | 'failed' | 'pending' | 'running' | 'superseded';
    threadId?: string | null;
    trigger?: QuickNoteAnalyzeTrigger | null;
  };
  tags: string[];
  topicId?: string;
  updatedAt: number;
}
