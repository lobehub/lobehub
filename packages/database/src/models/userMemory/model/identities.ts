import type { UserMemoryIdentityWithoutVectors } from '@lobechat/types';
import { IdentityTypeEnum, RelationshipEnum } from '@lobechat/types';
import type { AnyColumn } from 'drizzle-orm';
import { and, desc, eq, sql } from 'drizzle-orm';

import { merge } from '@/utils/merge';

import { userMemories, userMemoriesIdentities } from '../../../schemas';
import { selectNonVectorColumns } from '../../../utils/columns';
import type { UserMemoryModelContext } from './context';
import type {
  AddIdentityEntryParams,
  AddIdentityEntryResult,
  IdentityEntryPayload,
  UpdateIdentityEntryParams,
} from './types';
import { coerceDate } from './utils';

const normalizeRelationshipValue = (input: unknown): RelationshipEnum | null => {
  /* v8 ignore next -- unreachable: every caller maps null to null before normalizing */
  if (input === null) return null;
  if (typeof input !== 'string') return null;
  const normalized = input.trim().toLowerCase();
  return Object.values(RelationshipEnum).includes(normalized as RelationshipEnum)
    ? (normalized as RelationshipEnum)
    : null;
};

const normalizeIdentityTypeValue = (input: unknown): IdentityTypeEnum | null => {
  /* v8 ignore next -- unreachable: every caller maps null to null before normalizing */
  if (input === null) return null;
  if (typeof input !== 'string') return null;
  const normalized = input.trim().toLowerCase();
  return Object.values(IdentityTypeEnum).includes(normalized as IdentityTypeEnum)
    ? (normalized as IdentityTypeEnum)
    : null;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Shallow-merge supplied metadata keys over the stored object inside the UPDATE itself, so
 * concurrent partial updates of different keys cannot overwrite each other with a stale read.
 * A stored value that is not a JSON object is treated as empty.
 */
const mergeMetadataKeysSql = (column: AnyColumn, supplied: Record<string, unknown>) =>
  sql`(CASE WHEN jsonb_typeof(${column}) = 'object' THEN ${column} ELSE '{}'::jsonb END) || ${JSON.stringify(supplied)}::jsonb`;

export const addIdentityEntry = async (
  ctx: UserMemoryModelContext,
  params: AddIdentityEntryParams,
): Promise<AddIdentityEntryResult> => {
  const now = new Date();

  return ctx.db.transaction(async (tx) => {
    const base = params.base ?? {};
    const baseValues: typeof userMemories.$inferInsert = {
      accessedCount: 0,
      capturedAt: base.capturedAt,
      details: base.details ?? null,
      detailsVector1024: base.detailsVector1024 ?? null,
      lastAccessedAt: coerceDate(base.lastAccessedAt) ?? now,
      memoryCategory: base.memoryCategory ?? null,
      memoryLayer: base.memoryLayer ?? 'identity',
      memoryType: base.memoryType ?? null,
      metadata: base.metadata ?? null,
      status: base.status === undefined ? 'active' : base.status,
      summary: base.summary ?? null,
      summaryVector1024: base.summaryVector1024 ?? null,
      tags: base.tags ?? null,
      title: base.title ?? null,
      userId: ctx.userId,
    };

    const [userMemoryRecord] = await tx
      .insert(userMemories)
      .values(baseValues)
      .returning({ id: userMemories.id });

    const identity = params.identity ?? {};
    const identityValues: typeof userMemoriesIdentities.$inferInsert = {
      capturedAt: identity.capturedAt,
      description: identity.description ?? null,
      descriptionVector: identity.descriptionVector ?? null,
      episodicDate: identity.episodicDate === undefined ? null : coerceDate(identity.episodicDate),
      metadata: identity.metadata ?? null,
      relationship:
        identity.relationship === undefined
          ? null
          : identity.relationship === null
            ? null
            : (normalizeRelationshipValue(identity.relationship) ?? null),
      role: identity.role ?? null,
      tags: identity.tags ?? null,
      type:
        identity.type === undefined
          ? null
          : identity.type === null
            ? null
            : (normalizeIdentityTypeValue(identity.type) ?? null),
      userId: ctx.userId,
      userMemoryId: userMemoryRecord.id,
    };

    const [identityRecord] = await tx
      .insert(userMemoriesIdentities)
      .values(identityValues)
      .returning({ id: userMemoriesIdentities.id });

    return {
      identityId: identityRecord.id,
      userMemoryId: userMemoryRecord.id,
    };
  });
};

export const updateIdentityEntry = async (
  ctx: UserMemoryModelContext,
  params: UpdateIdentityEntryParams,
): Promise<boolean> => {
  const mergeStrategy = params.mergeStrategy ?? 'merge';

  return ctx.db.transaction(async (tx) => {
    const identity = await tx.query.userMemoriesIdentities.findFirst({
      where: and(
        eq(userMemoriesIdentities.id, params.identityId),
        ctx.memoryWhere(userMemoriesIdentities),
      ),
    });
    if (!identity || !identity.userMemoryId) {
      return false;
    }

    let baseUpdate: Partial<typeof userMemories.$inferInsert> = {};
    let identityUpdate: Partial<typeof userMemoriesIdentities.$inferInsert> = {};

    if (params.base) {
      baseUpdate = merge(baseUpdate, params.base);
      if (baseUpdate.lastAccessedAt !== undefined) {
        baseUpdate.lastAccessedAt = coerceDate(baseUpdate.lastAccessedAt) ?? new Date();
      }

      if (Object.keys(baseUpdate).length > 0) {
        baseUpdate.updatedAt = new Date();
        await tx
          .update(userMemories)
          .set(
            params.preserveOmittedFields && isPlainRecord(baseUpdate.metadata)
              ? {
                  ...baseUpdate,
                  metadata: mergeMetadataKeysSql(userMemories.metadata, baseUpdate.metadata),
                }
              : baseUpdate,
          )
          .where(and(eq(userMemories.id, identity.userMemoryId), ctx.memoryWhere(userMemories)));
      }
    }

    if (params.identity) {
      if (mergeStrategy === 'replace') {
        const identity = params.identity;

        identityUpdate = {
          capturedAt: identity.capturedAt,
          description: identity.description ?? null,
          descriptionVector: identity.descriptionVector ?? null,
          episodicDate:
            identity.episodicDate === undefined ? null : coerceDate(identity.episodicDate),
          metadata: identity.metadata ?? null,
          relationship:
            identity.relationship === undefined
              ? null
              : identity.relationship === null
                ? null
                : (normalizeRelationshipValue(identity.relationship) ?? null),
          role: identity.role ?? null,
          tags: identity.tags ?? null,
          type:
            identity.type === undefined
              ? null
              : identity.type === null
                ? null
                : (normalizeIdentityTypeValue(identity.type) ?? null),
        };

        if (params.preserveOmittedFields) {
          for (const key of Object.keys(identityUpdate) as (keyof typeof identityUpdate)[]) {
            if (identity[key as keyof IdentityEntryPayload] === undefined) {
              delete identityUpdate[key];
            }
          }
        }
      } else {
        identityUpdate = merge(identityUpdate, params.identity);

        if (params.identity.type !== undefined) {
          identityUpdate.type =
            params.identity.type === null
              ? null
              : (normalizeIdentityTypeValue(params.identity.type) ?? null);
        }

        if (params.identity.relationship !== undefined) {
          identityUpdate.relationship =
            params.identity.relationship === null
              ? null
              : (normalizeRelationshipValue(params.identity.relationship) ?? null);
        }

        if (params.identity.episodicDate !== undefined) {
          identityUpdate.episodicDate = coerceDate(params.identity.episodicDate);
        }

        if (params.identity.capturedAt !== undefined) {
          identityUpdate.capturedAt = params.identity.capturedAt;
        }
      }

      if (Object.keys(identityUpdate).length > 0) {
        identityUpdate.updatedAt = new Date();
        await tx
          .update(userMemoriesIdentities)
          .set(
            // A partial tool update names only the metadata keys it changes (e.g.
            // scoreConfidence); keep the other stored keys such as sourceEvidence.
            params.preserveOmittedFields && isPlainRecord(identityUpdate.metadata)
              ? {
                  ...identityUpdate,
                  metadata: mergeMetadataKeysSql(
                    userMemoriesIdentities.metadata,
                    identityUpdate.metadata,
                  ),
                }
              : identityUpdate,
          )
          .where(
            and(
              eq(userMemoriesIdentities.id, params.identityId),
              ctx.memoryWhere(userMemoriesIdentities),
            ),
          );
      }
    }

    return true;
  });
};

export const removeIdentityEntry = async (
  ctx: UserMemoryModelContext,
  identityId: string,
): Promise<boolean> => {
  return ctx.db.transaction(async (tx) => {
    const identity = await tx.query.userMemoriesIdentities.findFirst({
      where: and(
        eq(userMemoriesIdentities.id, identityId),
        ctx.memoryWhere(userMemoriesIdentities),
      ),
    });

    if (!identity || !identity.userMemoryId) {
      return false;
    }

    await tx
      .delete(userMemories)
      .where(and(eq(userMemories.id, identity.userMemoryId), ctx.memoryWhere(userMemories)));

    return true;
  });
};

export const getAllIdentities = async (
  ctx: UserMemoryModelContext,
): Promise<UserMemoryIdentityWithoutVectors[]> => {
  const res = await ctx.db
    .select(selectNonVectorColumns(userMemoriesIdentities))
    .from(userMemoriesIdentities)
    .where(ctx.memoryWhere(userMemoriesIdentities))
    .orderBy(desc(userMemoriesIdentities.capturedAt), desc(userMemoriesIdentities.createdAt));

  return res;
};

export const getAllIdentitiesWithMemory = async (ctx: UserMemoryModelContext) => {
  const res = await ctx.db
    .select({
      identity: selectNonVectorColumns(userMemoriesIdentities),
      memory: selectNonVectorColumns(userMemories),
    })
    .from(userMemoriesIdentities)
    .innerJoin(userMemories, eq(userMemories.id, userMemoriesIdentities.userMemoryId))
    .where(ctx.memoryWhere(userMemoriesIdentities))
    .orderBy(desc(userMemoriesIdentities.capturedAt), desc(userMemoriesIdentities.createdAt));

  return res;
};

export const getIdentitiesByType = async (
  ctx: UserMemoryModelContext,
  type: string,
): Promise<UserMemoryIdentityWithoutVectors[]> => {
  const res = await ctx.db
    .select(selectNonVectorColumns(userMemoriesIdentities))
    .from(userMemoriesIdentities)
    .where(and(ctx.memoryWhere(userMemoriesIdentities), eq(userMemoriesIdentities.type, type)))
    .orderBy(desc(userMemoriesIdentities.capturedAt), desc(userMemoriesIdentities.createdAt));

  return res;
};
