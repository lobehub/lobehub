import { z } from 'zod';

import { dateTimeSchema } from './common.type';

// ==================== Path Schemas ====================

export const RunIdParamSchema = z.object({ id: z.string().min(1) });
export type RunIdParam = z.infer<typeof RunIdParamSchema>;

export const RunInterventionParamSchema = z.object({
  id: z.string().min(1),
  interventionId: z.string().min(1),
});
export type RunInterventionParam = z.infer<typeof RunInterventionParamSchema>;

export const RunQueuedMessageParamSchema = z.object({
  id: z.string().min(1),
  messageId: z.string().min(1),
});
export type RunQueuedMessageParam = z.infer<typeof RunQueuedMessageParamSchema>;

// ==================== Run ====================

/**
 * Public run lifecycle. `waiting_for_human` parks on interventions,
 * `waiting_for_tool_results` on the caller's own function tools; both end the
 * run's event stream until they are answered.
 */
export const RUN_STATUSES = [
  'scheduled',
  'queued',
  'running',
  'waiting_for_human',
  'waiting_for_tool_results',
  'waiting_for_async_tool',
  'completed',
  'failed',
  'cancelled',
  'abandoned',
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES).meta({ id: 'RunStatus' });
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** Statuses a run never leaves; waiting ones still can. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'abandoned',
];

export const RunToolCallSchema = z
  .object({
    /** JSON-encoded arguments as the model produced them. */
    arguments: z.string(),
    /** Tool call id; answer client tools with it in `POST /runs/{id}/tool-results`. */
    id: z.string(),
    /** Function name; `<identifier>____<apiName>` for built-in tools, the bare name for yours. */
    name: z.string(),
  })
  .strict()
  .meta({ id: 'RunToolCall' });
export type RunToolCall = z.infer<typeof RunToolCallSchema>;

export const RunUsageSchema = z
  .object({
    inputTokens: z.number().int(),
    llmCalls: z.number().int(),
    outputTokens: z.number().int(),
    toolCalls: z.number().int(),
    totalTokens: z.number().int(),
  })
  .strict()
  .meta({ id: 'RunUsage' });
export type RunUsage = z.infer<typeof RunUsageSchema>;

export const RunErrorSchema = z
  .object({ message: z.string(), type: z.string().nullable() })
  .strict()
  .meta({ id: 'RunError' });
export type RunError = z.infer<typeof RunErrorSchema>;

export const RunSchema = z
  .object({
    agentId: z.string().nullable(),
    completedAt: dateTimeSchema.nullable(),
    /** Reason the runtime gave for stopping, e.g. `done`, `interrupted`, `waiting_for_human`. */
    completionReason: z.string().nullable(),
    /**
     * The run that continues this one after an intervention was resolved
     * through this API. A waiting run never resumes under its own id.
     */
    continuedByRunId: z.string().nullable(),
    cost: z.object({ currency: z.string(), total: z.number().nullable() }).strict(),
    createdAt: dateTimeSchema,
    error: RunErrorSchema.nullable(),
    groupId: z.string().nullable(),
    id: z.string(),
    maxSteps: z.number().int().nullable(),
    model: z.string().nullable(),
    parentRunId: z.string().nullable(),
    /** Open human interventions; see `GET /runs/{id}/interventions`. */
    pendingInterventionCount: z.number().int(),
    /** Your function tools the run waits on (`waiting_for_tool_results`). */
    pendingToolCalls: z.array(RunToolCallSchema),
    provider: z.string().nullable(),
    /** Final assistant reply of a finished run. */
    result: z
      .object({ content: z.string().nullable(), messageId: z.string().nullable() })
      .strict()
      .nullable(),
    startedAt: dateTimeSchema.nullable(),
    status: RunStatusSchema,
    /** LLM calls made so far. */
    stepCount: z.number().int(),
    taskId: z.string().nullable(),
    threadId: z.string().nullable(),
    topicId: z.string().nullable(),
    trigger: z.string().nullable(),
    usage: RunUsageSchema,
  })
  .strict()
  .meta({ id: 'Run' });
export type Run = z.infer<typeof RunSchema>;

// ==================== Create ====================

export const RunFunctionToolSchema = z
  .object({
    description: z.string().optional(),
    name: z.string().regex(/^[\w-]{1,64}$/, 'Use letters, digits, `_` or `-` (at most 64)'),
    /** JSON Schema of the arguments. */
    parameters: z.record(z.string(), z.unknown()).optional(),
    type: z.literal('function'),
  })
  .strict()
  .meta({ id: 'RunFunctionTool' });

export const CreateRunRequestSchema = z
  .object({
    /** The agent to run; with `groupId`, the member that must belong to the group. */
    agentId: z.string().min(1).optional(),
    approvalMode: z.enum(['headless', 'manual', 'allow-list', 'auto-run']).optional().meta({
      description:
        'How tool calls that need a person are handled. `headless` (default, as on `/responses` and `/im/messages`): never wait — tools that normally ask for approval run without asking, and calls that always need a person (questions to the user, commands caught by the security audit) are refused so the agent carries on. `auto-run`: the same, except those always-ask calls park the run as `waiting_for_human`. `manual`: every tool that asks for approval parks the run until it is resolved through `/runs/{id}/interventions`. `allow-list`: like `manual`, and every tool not in `allowList` asks.',
    }),
    /** Tools that run without approval in `allow-list` mode, as `<identifier>/<apiName>`. */
    allowList: z.array(z.string().min(1)).max(200).optional(),
    /** Already-uploaded files to attach to the input. */
    fileIds: z.array(z.string().min(1)).max(50).optional(),
    /** Run a group conversation turn, orchestrated by the group's supervisor. */
    groupId: z.string().min(1).optional(),
    /** The user message that starts the run. */
    input: z.string().min(1),
    /**
     * Start later instead of now (UTC ISO-8601, in the future). Nothing runs
     * until then: the response has status `scheduled` and no run id yet.
     */
    scheduledAt: z
      .string()
      .datetime()
      .optional()
      .refine((value) => !value || value.endsWith('Z'), 'Use UTC (`…Z`)'),
    /**
     * Function tools the caller executes itself. When the model calls one the
     * run parks as `waiting_for_tool_results` until you post the results.
     */
    tools: z.array(RunFunctionToolSchema).max(64).optional(),
    /** Continue an existing conversation instead of starting a new one. */
    topicId: z.string().min(1).optional(),
  })
  .strict()
  .refine((data) => data.agentId || data.groupId, {
    message: 'Either agentId or groupId must be provided',
    path: ['agentId'],
  })
  .refine((data) => !data.groupId || !data.tools?.length, {
    message: 'Function tools are not supported on group runs',
    path: ['tools'],
  })
  .refine((data) => !data.allowList || data.approvalMode === 'allow-list', {
    message: 'allowList only applies to approvalMode `allow-list`',
    path: ['allowList'],
  })
  .refine((data) => !data.groupId || !data.approvalMode, {
    message: 'approvalMode is not supported on group runs',
    path: ['approvalMode'],
  })
  .refine((data) => !data.scheduledAt || (!data.topicId && !data.tools?.length), {
    message: 'A scheduled run starts a new conversation and takes no function tools',
    path: ['scheduledAt'],
  });
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const CreateRunResultSchema = z
  .object({
    /** Run id (`operationId` elsewhere in the API); null while `scheduled`. */
    id: z.string().nullable(),
    /** When a scheduled run will start. */
    scheduledAt: dateTimeSchema.nullable(),
    status: z.enum(['queued', 'scheduled']),
    topicId: z.string(),
    /** The stored input message. */
    userMessageId: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'CreateRunResult' });
export type CreateRunResult = z.infer<typeof CreateRunResultSchema>;

// ==================== Cancel ====================

export const CancelRunResultSchema = z
  .object({
    /** False when the run had already finished; nothing changed. */
    cancelled: z.boolean(),
    id: z.string(),
    status: RunStatusSchema,
  })
  .strict()
  .meta({ id: 'CancelRunResult' });
export type CancelRunResult = z.infer<typeof CancelRunResultSchema>;

// ==================== Interventions ====================

export const RunInterventionSchema = z
  .object({
    /** Use as `interventionId`; it is the pending tool call's id. */
    id: z.string(),
    /** For `question`: the tool's arguments, which carry the questions to answer. */
    tool: z
      .object({
        apiName: z.string(),
        arguments: z.string(),
        identifier: z.string(),
      })
      .strict(),
    /**
     * `approval`: allow or refuse a tool call. `question`: the agent asks you;
     * answer it (or skip).
     */
    type: z.enum(['approval', 'question']),
  })
  .strict()
  .meta({ id: 'RunIntervention' });
export type RunIntervention = z.infer<typeof RunInterventionSchema>;

export const RunInterventionListSchema = z
  .object({ items: z.array(RunInterventionSchema) })
  .strict()
  .meta({ id: 'RunInterventionList' });

export const ResolveRunInterventionRequestSchema = z
  .discriminatedUnion('action', [
    z.object({ action: z.literal('approve') }).strict(),
    z
      .object({
        action: z.literal('reject'),
        /** Let the agent continue without the tool instead of ending the run. */
        continue: z.boolean().optional(),
        reason: z.string().max(2000).optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal('answer'),
        /** The answer as text; it becomes the tool's result. */
        content: z.string().min(1),
        /** Structured answers keyed by question id, for multi-question prompts. */
        answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal('skip'),
        reason: z.string().max(2000).optional(),
      })
      .strict(),
  ])
  .meta({ id: 'ResolveRunInterventionRequest' });
export type ResolveRunInterventionRequest = z.infer<typeof ResolveRunInterventionRequestSchema>;

export const ResolveRunInterventionResultSchema = z
  .object({
    /** The run that carries on from here; stream its events next. */
    continuedByRunId: z.string(),
    interventionId: z.string(),
  })
  .strict()
  .meta({ id: 'ResolveRunInterventionResult' });
export type ResolveRunInterventionResult = z.infer<typeof ResolveRunInterventionResultSchema>;

// ==================== Client tool results ====================

export const SubmitRunToolResultsRequestSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            /** The tool call id from `pendingToolCalls` / `tool_results.required`. */
            callId: z.string().min(1),
            /** The tool's output, as the model will read it. */
            output: z.string(),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict();
export type SubmitRunToolResultsRequest = z.infer<typeof SubmitRunToolResultsRequestSchema>;

export const SubmitRunToolResultsResultSchema = z
  .object({
    callIds: z.array(z.string()),
    /** The run id; it resumes under the same id. */
    id: z.string(),
    /**
     * `resumed`: the run continues now. `held`: your results are saved, but
     * server-side tools of the same batch are still out; the last one resumes it.
     */
    state: z.enum(['resumed', 'held']),
  })
  .strict()
  .meta({ id: 'SubmitRunToolResultsResult' });
export type SubmitRunToolResultsResult = z.infer<typeof SubmitRunToolResultsResultSchema>;

// ==================== Queued messages (steer) ====================

export const QueueRunMessageRequestSchema = z
  .object({
    content: z.string().min(1),
    fileIds: z.array(z.string().min(1)).max(50).optional(),
    /** Client-minted id; retrying with the same id queues at most once. */
    id: z
      .string()
      .regex(/^[\w-]{1,64}$/, 'Use letters, digits, `_` or `-` (at most 64)')
      .optional(),
  })
  .strict();
export type QueueRunMessageRequest = z.infer<typeof QueueRunMessageRequestSchema>;

export const RunQueuedMessageStateSchema = z.enum(['queued', 'delivering', 'taken']);

export const QueueRunMessageResultSchema = z
  .object({
    id: z.string(),
    /** Messages waiting behind the run, this one included. */
    length: z.number().int(),
    /** `delivering` / `taken`: a retry of a message the run already picked up. */
    state: RunQueuedMessageStateSchema,
  })
  .strict()
  .meta({ id: 'QueueRunMessageResult' });
export type QueueRunMessageResult = z.infer<typeof QueueRunMessageResultSchema>;

export const RunQueuedMessageSchema = z
  .object({
    content: z.string(),
    createdAt: dateTimeSchema,
    /** Picked up by the run and not confirmed yet; cannot be withdrawn. */
    delivering: z.boolean(),
    fileIds: z.array(z.string()),
    id: z.string(),
  })
  .strict()
  .meta({ id: 'RunQueuedMessage' });
export type RunQueuedMessage = z.infer<typeof RunQueuedMessageSchema>;

export const RunQueuedMessageListSchema = z
  .object({ items: z.array(RunQueuedMessageSchema) })
  .strict()
  .meta({ id: 'RunQueuedMessageList' });

export const RemoveRunQueuedMessageResultSchema = z
  .object({
    id: z.string(),
    removed: z.boolean(),
    /**
     * Where the message was: `removed`, or why not — `delivering` (the run
     * picked it up), `taken` (delivered), `absent` (never queued), `queued`
     * (still waiting; the removal lost a race, retry).
     */
    state: z.enum(['removed', 'delivering', 'taken', 'absent', 'queued']),
  })
  .strict()
  .meta({ id: 'RemoveRunQueuedMessageResult' });
export type RemoveRunQueuedMessageResult = z.infer<typeof RemoveRunQueuedMessageResultSchema>;

// ==================== Events ====================

export const RunEventsQuerySchema = z.object({
  /**
   * Resume after this event id (same as the `Last-Event-ID` header, which
   * wins). Omit to replay the run from its first event.
   */
  after: z
    .string()
    .regex(/^(0|\d+-\d+)$/)
    .optional(),
});
export type RunEventsQuery = z.infer<typeof RunEventsQuerySchema>;

const eventBase = {
  /** SSE `id`; reconnect with it as `Last-Event-ID` to resume without gaps. */
  id: z.string().nullable(),
  runId: z.string(),
  stepIndex: z.number().int(),
  timestamp: z.number().int(),
};

const event = <T extends string, S extends z.ZodRawShape>(type: T, data: S) =>
  z.object({ ...eventBase, data: z.object(data).strict(), type: z.literal(type) }).strict();

export const RunEventSchema = z
  .discriminatedUnion('type', [
    event('run.started', {}),
    event('step.started', { llmCalls: z.number().int() }),
    event('step.completed', { llmCalls: z.number().int() }),
    event('message.delta', { delta: z.string() }),
    event('reasoning.delta', { delta: z.string() }),
    event('message.completed', {
      content: z.string().nullable(),
      reasoning: z.string().nullable(),
      toolCalls: z.array(RunToolCallSchema),
    }),
    event('tool_call.started', { toolCall: RunToolCallSchema }),
    event('tool_call.completed', {
      /** Tool output as text, when the tool produced text. */
      content: z.string().nullable(),
      isSuccess: z.boolean(),
      toolCall: RunToolCallSchema,
    }),
    event('intervention.requested', { interventions: z.array(RunInterventionSchema) }),
    event('tool_results.required', { toolCalls: z.array(RunToolCallSchema) }),
    /** A step failed; `run.failed` follows when the run gives up. */
    event('run.error', { error: RunErrorSchema }),
    /** The run waits on you: resolve its interventions, or post your tools' results. */
    event('run.waiting', {
      status: z.enum(['waiting_for_human', 'waiting_for_tool_results']),
    }),
    event('run.completed', {
      result: z
        .object({ content: z.string().nullable(), messageId: z.string().nullable() })
        .strict()
        .nullable(),
    }),
    event('run.failed', { error: RunErrorSchema }),
    event('run.cancelled', {}),
  ])
  .meta({ id: 'RunEvent' });
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent['type'];

/** Events after which the server closes the stream. */
export const STREAM_CLOSING_EVENTS: readonly RunEventType[] = [
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.waiting',
];
