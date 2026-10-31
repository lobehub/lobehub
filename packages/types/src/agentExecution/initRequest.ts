import type { EvalMemoryReference } from '../eval/evalMemory';
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
 *. Plain JSON, because the state round-trips through Redis.
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
  /**
   * Files whose parsed body was left out of this request because it lives in
   * the documents table already. A parsed attachment can run to tens of MB — far
   * past what one state write can carry — so a persisted request keeps only the
   * id and the init reads the body back.
   */
  detachedFileContentIds?: string[];
  disableLocalSystem?: boolean;
  disableSelfFeedbackIntentTool?: boolean;
  disableTools?: boolean;
  /** A user turn that is prompted but never persisted (self-iteration runs). */
  ephemeralUserMessage?: string;
  /** The exact tool surface exposed to an isolated evaluation attempt. */
  evalAllowedTools?: string[];
  /** Server-created Memory scope for one evaluation attempt. */
  evalMemory?: EvalMemoryReference;
  /** When set, the run may use ONLY these tools. */
  exclusivePluginIds?: string[];
  /** The exact messages the caller supplied as history, instead of the topic's. */
  existingMessageIds?: string[];
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
  /**
   * What the user typed this turn. Also the content of the user row when one was
   * persisted, but a run from history has no row and still reads it.
   */
  prompt: string;
  requestedDeviceId?: string;
  /**
   * The topic the caller addressed, before the turn resolved or created one.
   * History is read from it, so a turn that opened a new topic reads none.
   */
  requestedTopicId?: string;
  requestTrigger?: string;
  /**
   * The request required its `requestedDeviceId` (`lh topic send --new --device`):
   * a plan that does not route to that device fails instead of degrading to
   * the cloud sandbox or another machine.
   */
  requireDevice?: boolean;
  /**
   * The caller re-answers an existing turn (regenerate / continue). Unlike
   * `resumeFromHistory`, a run that only suppresses its user row does not set it.
   */
  resume?: boolean;
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
  /** Skill identifiers the composer or CLI selected for this message. */
  selectedSkillIds?: string[];
  /** Tool identifiers the user @-mentioned in this message. */
  selectedToolIds?: string[];
  /** The Task this run executes, when it runs inside the Task system. */
  taskId?: string;
  topicBoundDeviceId?: string | null;
  /** The goal the user was viewing when they sent the turn. */
  viewedGoal?: { goalId: string };
}
