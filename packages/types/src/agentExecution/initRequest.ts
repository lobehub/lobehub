import type { ChatAudioItem, ChatFileItem, ChatVideoItem, MessagePluginItem } from '../message';
import type { RuntimeMentionedAgent } from '../stepContext';

/** Attachments the turn arrived with, already ingested to storage. */
export interface AgentRunAttachments {
  audioList?: ChatAudioItem[];
  fileIds?: string[];
  fileList?: ChatFileItem[];
  imageList?: Array<{ alt: string; id: string; url: string }>;
  videoList?: ChatVideoItem[];
  /** Per-file ingestion failures; surfaced to the user, never fatal. */
  warnings: string[];
}

/** One tool the user approved or rejected in a single action. */
export interface AgentRunApprovalDecision {
  decision: 'approved' | 'rejected' | 'rejected_continue';
  parentMessageId: string;
  rejectionReason?: string;
  toolCallId: string;
}

/**
 * What the caller asked for on this turn: the prompt's attachments, the tools
 * they picked, the flags the entry point set, and the human decision a resumed
 * approval carries.
 *
 * Every OTHER fact a run needs already has a typed home: the agent snapshot and
 * the channel facts on `world`, the approval mode on `principal.policy`, the
 * hooks and the queue policy on `host`, the model on `modelRuntimeConfig`. This
 * is the residue — the raw ask, which tool discovery and the context assembly
 * consume and then throw away.
 *
 * It lives on the state only while that work is still pending, which is what
 * lets it happen in the step-0 worker instead of on the send path
 * (LOBE-13745). Plain JSON, because the state round-trips through Redis.
 */
export interface AgentRunInitRequest {
  /** Internal additions (e.g. the task tool during task execution). */
  additionalPluginIds?: string[];
  agentSlug?: string | null;
  /** Assistant that emitted the approved batch — the pending tool rows' parent. */
  approvalOwnerAssistantId?: string;
  /** Approved decisions paired with the tool row each one fills. */
  approvedToolEntries: { plugin: MessagePluginItem; toolMessageId: string }[];
  attachedFileIds?: string[];
  disableLocalSystem?: boolean;
  disableSelfFeedbackIntentTool?: boolean;
  disableTools?: boolean;
  /** A user turn that is prompted but never persisted (self-iteration runs). */
  ephemeralUserMessage?: string;
  /** When set, the run may use ONLY these tools. */
  exclusivePluginIds?: string[];
  /** Mime types of the raw bot/IM uploads — all discovery reads off them. */
  externalFileTypes?: string[];
  /** Response-API client function tools the caller injected. */
  functionTools?: Array<{ description?: string; name: string; parameters?: Record<string, any> }>;
  globalMemoryEnabled: boolean;
  hasMentionedAgents: boolean;
  /** The caller pinned a device; the run must not silently execute elsewhere. */
  isFixedDeviceTarget: boolean;
  localDeviceId?: string;
  mentionedAgents?: RuntimeMentionedAgent[];
  parentMessageId?: string;
  requestedDeviceId?: string;
  requestTrigger?: string;
  resumeApproval?: AgentRunApprovalDecision;
  /** The pending tool row a single approval resumes. */
  resumeApprovalPlugin?: MessagePluginItem;
  resumeApprovals?: AgentRunApprovalDecision[];
  /** The run continues from history instead of a new user turn. */
  resumeFromHistory: boolean;
  resumeToolResult?: {
    content: string;
    outcome?: 'skipped' | 'submitted';
    parentMessageId: string;
    pluginState?: Record<string, unknown>;
    rejectionReason?: string;
    toolCallId: string;
  };
  runAttachments: AgentRunAttachments;
  /** Tool identifiers the user @-mentioned in this message. */
  selectedToolIds?: string[];
  topicBoundDeviceId?: string | null;
}
