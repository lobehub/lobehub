import { z } from 'zod';

export const AgentInterventionReviewTokenSchema = z
  .string()
  .regex(/^[\w-]{43}$/, 'Invalid intervention review token');

export const AgentInterventionRequestRevisionSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    version: z.number().int().nonnegative(),
  })
  .strict();

const ExpectedRevisionMapSchema = z
  .record(z.string().min(1), AgentInterventionRequestRevisionSchema)
  .refine((revisions) => Object.keys(revisions).length > 0, {
    message: 'Expected revisions must cover the sealed batch',
  });

const UniqueItemIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate item ids' });

const MAX_EDIT_ARGUMENT_KEYS = 100;
const MAX_SERIALIZED_EDIT_BYTES = 64 * 1024;
const isBoundedSerializedJSON = (value: unknown): boolean => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_SERIALIZED_EDIT_BYTES;
  } catch {
    return false;
  }
};
const EditedArgumentsSchema = z
  .record(
    z.string().min(1).max(500),
    z
      .record(z.string().min(1).max(500), z.unknown())
      .refine((arguments_) => Object.keys(arguments_).length <= MAX_EDIT_ARGUMENT_KEYS, {
        message: 'Too many edited argument keys',
      }),
  )
  .refine(isBoundedSerializedJSON, { message: 'Edited arguments are too large' });

const SelectProviderOptionSchema = z
  .object({
    itemId: z.string().min(1),
    optionId: z.string().min(1),
    type: z.literal('select_provider_option'),
  })
  .strict();

const ApproveToolSchema = z
  .object({
    edits: EditedArgumentsSchema.optional(),
    itemIds: UniqueItemIdsSchema,
    scope: z.enum(['once', 'remember']),
    type: z.literal('approve_tool'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.edits && data.itemIds.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Argument edits are allowed only for a single tool approval',
        path: ['edits'],
      });
    }
    if (data.edits && Object.keys(data.edits).some((id) => id !== data.itemIds[0])) {
      ctx.addIssue({
        code: 'custom',
        message: 'Argument edits must target the selected intervention',
        path: ['edits'],
      });
    }
  });

const RejectContinueSchema = z
  .object({
    itemIds: UniqueItemIdsSchema,
    reason: z.string().trim().max(2000).optional(),
    type: z.literal('reject_continue'),
  })
  .strict();

const StopSchema = z
  .object({
    scope: z.literal('operation'),
    type: z.literal('stop'),
  })
  .strict();

const SubmitAnswersSchema = z
  .object({
    itemId: z.string().min(1),
    result: z
      .record(
        z.string().min(1).max(500),
        z.union([z.string().max(4000), z.array(z.string().max(1000)).max(50)]),
      )
      .refine((result) => Object.keys(result).length > 0, {
        message: 'At least one answer is required',
      })
      .refine((result) => Object.keys(result).length <= 50, {
        message: 'Too many answers',
      }),
    type: z.literal('submit_answers'),
  })
  .strict();

const SubmitCustomSchema = z
  .object({
    itemId: z.string().min(1),
    // Exact external marketplace result. The Cloud adapter maps this to its
    // internal `selectedIds`; requestId/categoryHints are loaded from the
    // durable row and are never accepted from the client.
    result: z
      .object({
        kind: z.literal('agent_marketplace'),
        selectedTemplateIds: z.array(z.string().min(1)).min(1).max(50),
      })
      .strict(),
    type: z.literal('submit_custom'),
  })
  .strict();

const SkipInteractionSchema = z
  .object({
    itemId: z.string().min(1),
    type: z.literal('skip_interaction'),
  })
  .strict();

const CancelInteractionSchema = z
  .object({
    itemId: z.string().min(1),
    type: z.literal('cancel_interaction'),
  })
  .strict();

export const AgentInterventionResolutionActionSchema = z.discriminatedUnion('type', [
  SelectProviderOptionSchema,
  ApproveToolSchema,
  RejectContinueSchema,
  StopSchema,
  SubmitAnswersSchema,
  SubmitCustomSchema,
  SkipInteractionSchema,
  CancelInteractionSchema,
]);

export const GetAgentInterventionReviewSchema = z
  .object({ reviewToken: AgentInterventionReviewTokenSchema })
  .strict();

export const ResolveAgentInterventionSchema = z
  .object({
    action: AgentInterventionResolutionActionSchema,
    expectedBatchVersion: z.number().int().nonnegative(),
    expectedRequestRevisions: ExpectedRevisionMapSchema,
    resolutionRequestId: z.string().uuid(),
    reviewToken: AgentInterventionReviewTokenSchema,
  })
  .strict();

const AgentInterventionSourceTargetSchema = z
  .object({
    toolCallId: z.string().min(1),
    toolMessageId: z.string().min(1),
  })
  .strict();

const AgentInterventionSourceTargetsSchema = z
  .array(AgentInterventionSourceTargetSchema)
  .min(1)
  .max(100)
  .superRefine((targets, ctx) => {
    const toolCallIds = targets.map(({ toolCallId }) => toolCallId);
    const toolMessageIds = targets.map(({ toolMessageId }) => toolMessageId);
    if (
      new Set(toolCallIds).size !== toolCallIds.length ||
      new Set(toolMessageIds).size !== toolMessageIds.length
    ) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate source targets' });
    }
  });

export const GetAgentInterventionReviewBySourceSchema = z
  .object({
    batchId: z.string().min(1),
    operationId: z.string().min(1),
    targets: AgentInterventionSourceTargetsSchema,
  })
  .strict();

const AgentInterventionSourceActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      optionId: z.string().min(1),
      type: z.literal('select_provider_option'),
    })
    .strict(),
  z
    .object({
      edits: EditedArgumentsSchema.optional(),
      scope: z.enum(['once', 'remember']),
      type: z.literal('approve_tool'),
    })
    .strict(),
  z
    .object({
      reason: z.string().trim().max(2000).optional(),
      type: z.literal('reject_continue'),
    })
    .strict(),
  z.object({ scope: z.literal('operation'), type: z.literal('stop') }).strict(),
  z
    .object({
      result: SubmitAnswersSchema.shape.result,
      type: z.literal('submit_answers'),
    })
    .strict(),
  z
    .object({
      result: SubmitCustomSchema.shape.result,
      type: z.literal('submit_custom'),
    })
    .strict(),
  z.object({ type: z.literal('skip_interaction') }).strict(),
  z.object({ type: z.literal('cancel_interaction') }).strict(),
]);

export const ResolveAgentInterventionBySourceSchema = z
  .object({
    action: AgentInterventionSourceActionSchema,
    batchId: z.string().min(1),
    operationId: z.string().min(1),
    resolutionRequestId: z.string().uuid(),
    targets: AgentInterventionSourceTargetsSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.action.type !== 'approve_tool' || !data.action.edits) return;
    if (data.targets.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Argument edits are allowed only for one source target',
        path: ['action', 'edits'],
      });
      return;
    }
    const [target] = data.targets;
    const editedMessageIds = Object.keys(data.action.edits);
    if (editedMessageIds.length !== 1 || editedMessageIds[0] !== target.toolMessageId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Argument edits must target the source tool message',
        path: ['action', 'edits'],
      });
    }
  });
