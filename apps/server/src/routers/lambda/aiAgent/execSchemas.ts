import {
  CreateThreadWithMessageSchema,
  initialTopicMetadataSchema,
  RequestTrigger,
  UserInterventionConfigSchema,
} from '@lobechat/types';
import { z } from 'zod';

import { execAgentClientIdsSchema } from '@/server/routers/lambda/_helpers/execAgentClientIds';
import { MAX_CLIENT_OPERATION_SNAPSHOT } from '@/server/services/agentRuntime/foregroundOperation';

/** A client's declaration that it can run relayed LLM attempts (`agent_llm_relay`). */
export const LlmExecutorSchema = z.object({
  capabilities: z.array(z.string()).max(16),
  clientId: z.string().min(1).max(128),
  providers: z.array(z.string()).max(256),
});

/** One human decision on a pending `role='tool'` message. */
export const ResumeApprovalDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'rejected_continue']),
  /** ID of the pending `role='tool'` message this decision targets. */
  parentMessageId: z.string(),
  /** Optional user-supplied rejection reason (only meaningful for rejected variants). */
  rejectionReason: z.string().optional(),
  /** tool_call_id of the pending tool call being approved/rejected. */
  toolCallId: z.string(),
});

/** A human-provided result for a pending `humanIntervention: 'always'` tool. */
export const ResumeToolResultSchema = z.object({
  /** The human-provided tool result (the answer text). */
  content: z.string(),
  /** ID of the pending `role='tool'` message this result targets. */
  parentMessageId: z.string(),
  /** Optional plugin state to persist on the tool message. */
  pluginState: z.record(z.string(), z.unknown()).optional(),
  /** Whether the form was submitted or explicitly skipped. */
  outcome: z.enum(['submitted', 'skipped']).optional().default('submitted'),
  /** Optional skip reason, persisted only when outcome is skipped. */
  rejectionReason: z.string().optional(),
  /** tool_call_id of the pending tool call being answered. */
  toolCallId: z.string(),
});

/**
 * Cross-field rules for an intervention resume payload, shared by every
 * execAgent entry point that accepts one (owner and share visitor).
 */
export const validateResumePayload = (
  data: {
    parentMessageId?: string;
    resumeApproval?: z.infer<typeof ResumeApprovalDecisionSchema>;
    resumeApprovals?: z.infer<typeof ResumeApprovalDecisionSchema>[];
    resumeToolResult?: z.infer<typeof ResumeToolResultSchema>;
  },
  ctx: z.RefinementCtx,
) => {
  const resumePayloadCount = [
    data.resumeApproval,
    data.resumeApprovals,
    data.resumeToolResult,
  ].filter(Boolean).length;
  if (resumePayloadCount > 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'Only one of resumeApproval, resumeApprovals, or resumeToolResult is allowed',
      path: ['resumeApproval'],
    });
  }

  if (resumePayloadCount > 0 && !data.parentMessageId) {
    ctx.addIssue({
      code: 'custom',
      message: 'parentMessageId is required for an intervention resume',
      path: ['parentMessageId'],
    });
  }

  if (
    data.resumeApproval &&
    data.parentMessageId &&
    data.resumeApproval.parentMessageId !== data.parentMessageId
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'resumeApproval must target parentMessageId',
      path: ['resumeApproval', 'parentMessageId'],
    });
  }
  if (
    data.resumeToolResult &&
    data.parentMessageId &&
    data.resumeToolResult.parentMessageId !== data.parentMessageId
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'resumeToolResult must target parentMessageId',
      path: ['resumeToolResult', 'parentMessageId'],
    });
  }

  if (data.resumeApprovals) {
    const messageIds = data.resumeApprovals.map(({ parentMessageId }) => parentMessageId);
    const toolCallIds = data.resumeApprovals.map(({ toolCallId }) => toolCallId);
    if (
      new Set(messageIds).size !== messageIds.length ||
      new Set(toolCallIds).size !== toolCallIds.length
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'resumeApprovals cannot contain duplicate targets',
        path: ['resumeApprovals'],
      });
    }
    if (data.parentMessageId && !messageIds.includes(data.parentMessageId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'parentMessageId must be one of the resumeApprovals targets',
        path: ['parentMessageId'],
      });
    }
  }
};

export const ExecAgentSchema = z
  .object({
    includeFinalState: z.boolean().optional(),
    /**
     * Gateway stream features the calling client handles. `member_runtime_end`:
     * a group member's terminal arrives on the supervisor's channel under that
     * name instead of `agent_runtime_end`. `file_works`: pushed snapshots may
     * carry `file` Work summaries. Free-form strings so an older server
     * ignores features it does not know rather than rejecting the run.
     */
    streamFeatures: z.array(z.string()).optional(),
    /**
     * Wire protocol the calling client speaks. `2` declares it reconciles its
     * message list from `message_patch` revisions, so the run may stop pushing
     * whole `uiMessages` snapshots. Absent ⇒ 1 (an older bundle, the CLI, or a
     * server-initiated run), which keeps the pushed snapshots.
     */
    clientProtocol: z.union([z.literal(1), z.literal(2)]).optional(),
    /**
     * The calling client can execute single LLM attempts the server relays to
     * it (`llm_execute`) for providers only this device can reach. Sent only
     * when the client is inside the `agent_llm_relay` rollout.
     */
    llmExecutor: LlmExecutorSchema.optional(),
    /** The agent ID to run (either agentId or slug is required) */
    agentId: z.string().optional(),
    /** Application context for message storage */
    appContext: z
      .object({
        conversationAgentId: z.string().optional(),
        defaultTaskAssigneeAgentId: z.string().optional(),
        documentId: z.string().nullish(),
        /** The agent being edited when scope is 'agent_builder' (not the builder builtin itself). */
        editingAgentId: z.string().optional(),
        /** The group being edited when scope is 'group_agent_builder' (not a group chat turn). */
        editingGroupId: z.string().optional(),
        groupId: z.string().nullish(),
        // The shared declaration, not a copy of it: a local `z.object()` here
        // silently strips whatever the type gained and the call still answers
        // 200, so the two must be one thing.
        initialTopicMetadata: initialTopicMetadataSchema.optional(),
        /**
         * Branch this run into a new thread (subtopic) under the resolved topic.
         * The gateway path never calls `aiChat.sendMessageInServer`, so this is
         * the only way the composer's "start a new subtopic" intent reaches the
         * server — without it the turn lands on the topic's main spine.
         */
        newThread: CreateThreadWithMessageSchema.optional(),
        /**
         * Group orchestration role of the run, stamped onto the assistant
         * message's `metadata.orchestrationRole` so the supervisor/member
         * identity survives the gateway step_start snapshot / refetch.
         */
        orchestrationRole: z.enum(['supervisor', 'member']).optional(),
        /** Bind a NEW topic to this project working directory (ignored with topicId). */
        projectWorkingDirectoryId: z.string().optional(),
        scope: z.string().nullish(),
        sessionId: z.string().optional(),
        taskId: z.string().nullish(),
        threadId: z.string().nullish(),
        topicId: z.string().nullish(),
      })
      .optional(),
    /** Whether to auto-start execution after creating operation */
    autoStart: z.boolean().optional().default(true),
    /** Client-minted row ids, honoured verbatim (see `execAgentClientIdsSchema`). */
    clientIds: execAgentClientIdsSchema,
    /** Explicit device ID to bind to the topic and activate for this run */
    deviceId: z.string().optional(),
    /** Current desktop device hint, honored only for an effective local target */
    localDeviceId: z.string().optional(),
    /** Optional existing message IDs to include in context */
    existingMessageIds: z.array(z.string()).optional().default([]),
    /** File IDs of already-uploaded attachments to attach to the new user message */
    fileIds: z.array(z.string()).optional(),
    /** Parent message ID for regeneration/continue (skip user message creation, branch from this message) */
    parentMessageId: z.string().optional(),
    /** Existing gateway operation this fresh turn atomically supersedes. */
    replacesOperationId: z.string().optional(),
    /**
     * The server runs the composer tracked on this conversation at send time.
     * Diagnostic only: recorded when this send has to supersede a live run.
     */
    clientOperations: z
      .array(
        z.object({
          isAborting: z.boolean().optional(),
          operationId: z.string(),
          status: z.string(),
          visibleLoadingDone: z.boolean().optional(),
        }),
      )
      .max(MAX_CLIENT_OPERATION_SNAPSHOT)
      .optional(),
    /** The user input/prompt */
    prompt: z.string(),
    /**
     * Resume a previous op paused on `human_approve_required`. When set, the
     * new op writes the decision to the target tool message and either runs
     * the approved tool (`approved`), halts with reason=`human_rejected`
     * (`rejected`), or surfaces the rejection as user feedback so the LLM
     * can continue (`rejected_continue`).
     */
    resumeApproval: ResumeApprovalDecisionSchema.optional(),
    /**
     * Batch form of `resumeApproval` — one entry per pending tool the user
     * resolved in a single action ("approve all" on a parallel tool batch).
     * The op applies every decision, then runs all approved tools in ONE
     * `call_tools_batch` and continues the LLM once with the full result set.
     *
     * Prefer this over firing N `resumeApproval` ops for a parallel batch: each
     * of those continues the LLM while the not-yet-approved tools are still
     * empty rows, which forks the parent chain and shows the model blank
     * results. Mutually exclusive with `resumeApproval`.
     */
    resumeApprovals: z.array(ResumeApprovalDecisionSchema).min(1).optional(),
    /**
     * Resume a previous op paused on a `humanIntervention: 'always'` tool (e.g.
     * lobe-agent `askUserQuestion`). When set, the new op writes the
     * human-provided answer as the target tool message's result and resumes from
     * `phase: 'tool_result'` — the tool is NOT re-executed, so the runtime never
     * overwrites the answer with a fresh "pending" placeholder. Mutually
     * exclusive with `resumeApproval`.
     */
    resumeToolResult: ResumeToolResultSchema.optional(),
    /**
     * Tool identifiers the user @-mentioned in this message. Enabled for this
     * run in addition to the agent's pinned plugins, so a mentioned tool that
     * isn't pinned to the agent (e.g. a custom MCP connector picked from the @
     * list) is callable. Scoped to the caller's own installed tools/connectors
     * by the user-scoped lookups downstream, so it can't enable others' tools.
     */
    selectedToolIds: z.array(z.string()).optional(),
    /**
     * Skill identifiers the user selected for this message. Their bodies are
     * injected directly for this turn and every later turn of the topic, the
     * same way a pinned skill is, instead of waiting for `activateSkill`.
     * Persisted on the user message as `metadata.selectedSkillIds`.
     */
    selectedSkillIds: z.array(z.string()).optional(),
    /**
     * Agents the user @-mentioned in this message (multi-mention). When present
     * (and non-group), the run enables the callAgent tool and injects the
     * mentioned-agents delegation context so the supervisor delegates to them
     * instead of answering itself. Mirrors the client runtime's
     * `initialContext.mentionedAgents` + injected callAgent manifest.
     */
    mentionedAgents: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
    /** The agent slug to run (either agentId or slug is required) */
    slug: z.string().optional(),
    /**
     * What initiated this operation, persisted to `agent_operations.trigger`.
     * Defaults to `'chat'` when omitted — first-party SPA / desktop user
     * messages are the dominant caller. Pass a more specific value (`'cli'`,
     * `'openapi'`, `'eval'`, …) to override.
     */
    /**
     * The prompt was queued while the previous turn was still running. The
     * persisted user message carries `metadata.steer` so it renders as a
     * continuation of that turn instead of a new one.
     */
    steer: z.boolean().optional(),
    trigger: z
      .string()
      .refine((value) => value !== RequestTrigger.Bot, {
        message: 'The bot trigger is reserved for authenticated server-side bot ingress',
      })
      .optional(),
    /**
     * The operation the launching agent's run belongs to, when another agent
     * started this run (agent → agent: a sibling agent calling `lh agent run`).
     * The launcher's own agent id is deliberately not sent — device-dispatched
     * runs strip it — and neither is its topic: the server reads both from this
     * operation row (ownership-scoped, the caller's own) and stamps
     * `metadata.agentSender` on the created user message. An unknown, foreign,
     * or topic-less operation simply resolves to nothing.
     */
    sourceOperationId: z.string().optional(),
    /**
     * User intervention configuration for tool approvals.
     * Pass `{ approvalMode: 'headless' }` from headless clients (CLI, cron, bots)
     * so tool calls auto-execute without waiting for human approval.
     */
    userInterventionConfig: UserInterventionConfigSchema.optional(),
  })
  .refine((data) => data.agentId || data.slug, {
    message: 'Either agentId or slug must be provided',
  })
  .superRefine(validateResumePayload);

export type ExecAgentInput = z.infer<typeof ExecAgentSchema>;

/**
 * Schema for execGroupAgent - execute Supervisor Agent in Group chat
 */
export const ExecGroupAgentSchema = z.object({
  /** The Supervisor agent ID */
  agentId: z.string(),
  /** File IDs attached to the message */
  files: z.array(z.string()).optional(),
  /** The Group ID */
  groupId: z.string(),
  /** User message content */
  message: z.string(),
  /** Optional: Create a new topic */
  newTopic: z
    .object({
      title: z.string().optional(),
      topicMessageIds: z.array(z.string()).optional(),
    })
    .optional(),
  /** Existing topic ID */
  topicId: z.string().nullish(),
});

/**
 * Schema for execAgents - batch execution of multiple agents
 */
export const ExecAgentsSchema = z.object({
  /** Whether to execute tasks in parallel (default: true) */
  parallel: z.boolean().optional().default(true),
  /** Array of agent tasks to execute */
  tasks: z.array(ExecAgentSchema).min(1),
});

/**
 * Schema for scheduleAgentRun - defer an agent run to a future time
 */
export const ScheduleAgentRunSchema = z
  .object({
    /** The agent ID to run (either agentId or slug is required) */
    agentId: z.string().optional(),
    /** File IDs of already-uploaded attachments to attach when the run fires */
    fileIds: z.array(z.string()).optional(),
    /** Group to file the topic under, when scheduling from a group conversation */
    groupId: z.string().nullish(),
    /** Override the agent's default model */
    model: z.string().optional(),
    /** The user input/prompt, replayed verbatim when the run comes due */
    prompt: z.string().min(1),
    /** Override the agent's default provider */
    provider: z.string().optional(),
    /**
     * When to run. UTC ISO-8601 (`…Z`) — the dispatcher's due query compares it
     * as text, so a zoned offset would break the ordering.
     */
    runAt: z.string().datetime(),
    /** The agent slug to run (either agentId or slug is required) */
    slug: z.string().optional(),
  })
  .refine((data) => data.agentId || data.slug, {
    message: 'Either agentId or slug must be provided',
  });

/**
 * Schema for execSubAgentTask - execute SubAgent task
 * Supports both Group mode (with groupId) and Single Agent mode (without groupId)
 */
export const ExecSubAgentTaskSchema = z.object({
  /** The SubAgent ID to execute the task */
  agentId: z.string(),
  /** The Group ID (optional, only for Group mode) */
  groupId: z.string().optional(),
  /** Task instruction/prompt for the SubAgent */
  instruction: z.string(),
  /**
   * The dispatching tab runs the sub-agent's device-only LLM calls: its
   * executor declaration and the one-shot relay channel it subscribed to for
   * them. Both or neither.
   */
  llmExecutor: LlmExecutorSchema.optional(),
  llmRelayChannel: z.string().min(1).max(256).optional(),
  /** The parent message ID (Supervisor's tool call message or task message) */
  parentMessageId: z.string(),
  /** Parent operation ID for dispatching callAgent hooks */
  parentOperationId: z.string().optional(),
  /** Timeout in milliseconds (optional) */
  timeout: z.number().optional(),
  /** Task title (shown in UI, used as thread title) */
  title: z.string().optional(),
  /** The Topic ID */
  topicId: z.string(),
});
