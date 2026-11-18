import { RESOURCE_TRANSFER_REQUEST_STATUSES, TRANSFER_RESOURCE_TYPES } from '@lobechat/types';
import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema } from './common.type';

/**
 * Member-to-member ownership handover inside a team workspace. A request is
 * created by the resource's creator (or a workspace owner) and only moves
 * ownership once the recipient accepts it.
 */

/** Resource types a member transfer can be started for today. */
export const MEMBER_TRANSFER_RESOURCE_TYPES = ['agent', 'agentGroup'] as const;

// ==================== Path / Query Schemas ====================

export const TransferRequestIdParamSchema = z.object({
  id: z.string().min(1).describe('Transfer request id'),
});
export type TransferRequestIdParam = z.infer<typeof TransferRequestIdParamSchema>;

export const TransferRequestListQuerySchema = CursorPaginationQuerySchema;
export type TransferRequestListQuery = z.infer<typeof TransferRequestListQuerySchema>;

// ==================== Request Schemas ====================

export const CreateTransferRequestSchema = z
  .object({
    recipientId: z.string().min(1).describe('User id of the workspace member to hand it to'),
    resourceId: z.string().min(1),
    resourceType: z.enum(MEMBER_TRANSFER_RESOURCE_TYPES),
  })
  .strict();
export type CreateTransferRequest = z.infer<typeof CreateTransferRequestSchema>;

// ==================== Response Schemas ====================

const TransferPartySchema = z
  .object({
    avatar: z.string().nullable(),
    fullName: z.string().nullable(),
    id: z.string(),
    username: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'TransferParty' });

const TransferResourceSummarySchema = z
  .object({
    avatar: z.string().nullable(),
    backgroundColor: z.string().nullable(),
    id: z.string(),
    title: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'TransferResourceSummary' });

export const TransferRequestStatusSchema = z.enum(RESOURCE_TRANSFER_REQUEST_STATUSES);

export const TransferRequestSchema = z
  .object({
    createdAt: dateTimeSchema,
    expiresAt: dateTimeSchema,
    id: z.string(),
    initiator: TransferPartySchema.nullable(),
    initiatorId: z.string().nullable(),
    previousOwner: TransferPartySchema.nullable(),
    previousOwnerId: z.string().nullable(),
    recipient: TransferPartySchema.nullable(),
    recipientId: z.string().nullable(),
    resolvedAt: dateTimeSchema.nullable(),
    resource: TransferResourceSummarySchema.nullable(),
    resourceId: z.string(),
    resourceType: z.enum(TRANSFER_RESOURCE_TYPES),
    status: TransferRequestStatusSchema,
  })
  .strict()
  .meta({ id: 'TransferRequest' });
export type TransferRequest = z.infer<typeof TransferRequestSchema>;

export const TransferRequestListResponseSchema = paginatedListSchema(TransferRequestSchema, {
  total: true,
});

/** What answering or withdrawing a request returns: where it ended up. */
export const TransferRequestOutcomeSchema = z
  .object({ id: z.string(), status: TransferRequestStatusSchema })
  .strict()
  .meta({ id: 'TransferRequestOutcome' });
export type TransferRequestOutcome = z.infer<typeof TransferRequestOutcomeSchema>;
