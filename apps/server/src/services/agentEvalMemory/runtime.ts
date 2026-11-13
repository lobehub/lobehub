import type { MemoryRuntimeService } from '@lobechat/builtin-tool-memory/executionRuntime';
import type { LobeChatDatabase } from '@lobechat/database';
import type {
  ActivityMemoryItemSchema,
  AddIdentityActionSchema,
  ContextMemoryItemSchema,
  ExperienceMemoryItemSchema,
  PreferenceMemoryItemSchema,
  RemoveIdentityActionSchema,
  UpdateIdentityToolInputSchema,
} from '@lobechat/memory-user-memory/schemas';
import type {
  AddActivityMemoryResult,
  AddContextMemoryResult,
  AddExperienceMemoryResult,
  AddIdentityMemoryResult,
  AddPreferenceMemoryResult,
  AgentEvalMemoryItem,
  EvalMemoryReference,
  QueryTaxonomyOptionsParams,
  QueryTaxonomyOptionsResult,
  RemoveIdentityMemoryResult,
  SearchMemoryParams,
  SearchMemoryResult,
  UpdateIdentityMemoryResult,
} from '@lobechat/types';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { normalizeUserMemorySearchQueries } from '@/database/models/userMemory';
import { agentEvalMemories } from '@/database/schemas';
import { getEvalAttemptId } from '@/server/services/agentEvalRun/utils';
import {
  type MemorySearchEffort,
  normalizeSearchMemoryParams,
  resolveMemorySearchTopK,
} from '@/server/services/memory/userMemory/searchParams';

import type { EvalMemoryEmbedder } from './embedding';
import { draftOf, type EvalMemoryDraft, semanticText } from './entries';
import { searchEvalMemory } from './search';
import { attemptWhere } from './where';

export { attemptWhere } from './where';

type Payload = Record<string, any>;

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** The account's Memory reads an unknown effort as medium. */
const normalizeEffort = (value: unknown, fallback: MemorySearchEffort): MemorySearchEffort => {
  if (value === undefined || value === null) return fallback;
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium';
};

/**
 * The Memory tool of an eval attempt. Same surface as the account's Memory
 * runtime, backed by the attempt's own rows: the fixture it was seeded with
 * plus what the Agent writes during the attempt. Search is the account's
 * hybrid search run over those rows (`searchEvalMemory`), with the queries
 * embedded by the account's embedding model and the effort's limits.
 */
export class EvalMemoryRuntimeService implements MemoryRuntimeService {
  constructor(
    private readonly options: {
      db: LobeChatDatabase;
      embed: EvalMemoryEmbedder;
      memoryEffort: MemorySearchEffort;
      reference: EvalMemoryReference;
      userId: string;
    },
  ) {}

  private get db() {
    return this.options.db;
  }

  private rows = (includeRemoved = false) =>
    this.db
      .select()
      .from(agentEvalMemories)
      .where(attemptWhere(this.options.userId, this.options.reference, { includeRemoved }))
      .orderBy(asc(agentEvalMemories.capturedAt), asc(agentEvalMemories.createdAt));

  private save = async (draft: EvalMemoryDraft) => {
    const { reference, userId } = this.options;
    const [embedding] = await this.options.embed([semanticText(draft)]);
    const [row] = await this.db
      .insert(agentEvalMemories)
      .values({
        ...draft,
        attemptId: getEvalAttemptId(reference),
        capturedAt: new Date(),
        embedding: embedding ?? null,
        runId: reference.runId,
        source: 'agent',
        threadId: reference.threadId ?? null,
        topicId: reference.topicId,
        userId,
      })
      .returning();
    return row;
  };

  private failure = (error: unknown) => ({
    message: `Failed to save memory: ${error instanceof Error ? error.message : String(error)}`,
    success: false as const,
  });

  searchMemory = async (params: SearchMemoryParams): Promise<SearchMemoryResult> => {
    const normalized = normalizeSearchMemoryParams(params);
    const queries = normalizeUserMemorySearchQueries(normalized.queries);
    const queryEmbeddings =
      queries.length > 0
        ? (await this.options.embed(queries)).filter((e): e is number[] => !!e)
        : [];
    const effort = normalizeEffort(normalized.effort, this.options.memoryEffort);
    return searchEvalMemory({
      db: this.db,
      params: { ...normalized, queries, topK: resolveMemorySearchTopK(effort, normalized) },
      queryEmbeddings,
      reference: this.options.reference,
      userId: this.options.userId,
    });
  };

  queryTaxonomyOptions = async (
    params: QueryTaxonomyOptionsParams,
  ): Promise<QueryTaxonomyOptionsResult> => {
    const limit = params.limit ?? 20;
    const q = params.q?.toLowerCase();
    const wantedLayers = params.layers?.length ? new Set(params.layers.map(String)) : undefined;
    const include = new Set(params.include ?? []);
    const rows = (await this.rows()).filter(
      (row) =>
        row.layer !== 'persona' &&
        (!wantedLayers || wantedLayers.has(row.layer)) &&
        (!params.timeRange?.start || row.capturedAt >= params.timeRange.start) &&
        (!params.timeRange?.end || row.capturedAt <= params.timeRange.end),
    );
    const facet = (
      name: NonNullable<QueryTaxonomyOptionsParams['include']>[number],
      pick: (row: AgentEvalMemoryItem) => unknown[],
    ) => {
      if (include.size > 0 && !include.has(name)) return { hasMore: false, items: [] };
      const counts = new Map<string, { count: number; layers: Set<string> }>();
      for (const row of rows) {
        for (const value of pick(row)) {
          if (typeof value !== 'string' || !value || (q && !value.toLowerCase().includes(q)))
            continue;
          const entry = counts.get(value) ?? { count: 0, layers: new Set() };
          entry.count += 1;
          entry.layers.add(row.layer);
          counts.set(value, entry);
        }
      }
      const items = [...counts.entries()]
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
        .map(([value, entry]) => ({
          count: entry.count,
          layers: [...entry.layers] as QueryTaxonomyOptionsResult['types'][number]['layers'],
          value,
        }));
      return { hasMore: items.length > limit, items: items.slice(0, limit) };
    };
    const payload = (row: AgentEvalMemoryItem) => row.payload as Payload;
    const categories = facet('categories', (row) => [row.memoryCategory]);
    const labels = facet('labels', (row) => [
      ...asList(payload(row).extractedLabels),
      ...asList(payload(row).labels),
    ]);
    const relationships = facet('relationships', (row) => [payload(row).relationship]);
    const roles = facet('roles', (row) => [payload(row).role]);
    const statuses = facet('statuses', (row) => [
      payload(row).currentStatus ?? payload(row).status,
    ]);
    const tags = facet('tags', (row) => asList(row.tags));
    const types = facet('types', (row) => [row.memoryType ?? payload(row).type]);
    return {
      categories: categories.items,
      hasMore: {
        categories: categories.hasMore,
        labels: labels.hasMore,
        relationships: relationships.hasMore,
        roles: roles.hasMore,
        statuses: statuses.hasMore,
        tags: tags.hasMore,
        types: types.hasMore,
      },
      labels: labels.items,
      relationships: relationships.items,
      roles: roles.items,
      statuses: statuses.items,
      tags: tags.items,
      types: types.items,
    };
  };

  addContextMemory = async (
    input: z.infer<typeof ContextMemoryItemSchema>,
  ): Promise<AddContextMemoryResult> => {
    try {
      const row = await this.save(draftOf('context', input, 'withContext'));
      return {
        contextId: row.id,
        memoryId: row.id,
        message: 'Memory saved successfully',
        success: true,
      };
    } catch (error) {
      return this.failure(error);
    }
  };

  addActivityMemory = async (
    input: z.infer<typeof ActivityMemoryItemSchema>,
  ): Promise<AddActivityMemoryResult> => {
    try {
      const row = await this.save(draftOf('activity', input, 'withActivity'));
      return {
        activityId: row.id,
        memoryId: row.id,
        message: 'Memory saved successfully',
        success: true,
      };
    } catch (error) {
      return this.failure(error);
    }
  };

  addExperienceMemory = async (
    input: z.infer<typeof ExperienceMemoryItemSchema>,
  ): Promise<AddExperienceMemoryResult> => {
    try {
      const row = await this.save(draftOf('experience', input, 'withExperience'));
      return {
        experienceId: row.id,
        memoryId: row.id,
        message: 'Memory saved successfully',
        success: true,
      };
    } catch (error) {
      return this.failure(error);
    }
  };

  addPreferenceMemory = async (
    input: z.infer<typeof PreferenceMemoryItemSchema>,
  ): Promise<AddPreferenceMemoryResult> => {
    try {
      const row = await this.save(draftOf('preference', input, 'withPreference'));
      return {
        memoryId: row.id,
        message: 'Memory saved successfully',
        preferenceId: row.id,
        success: true,
      };
    } catch (error) {
      return this.failure(error);
    }
  };

  addIdentityMemory = async (
    input: z.infer<typeof AddIdentityActionSchema>,
  ): Promise<AddIdentityMemoryResult> => {
    try {
      const row = await this.save(draftOf('identity', input, 'withIdentity'));
      return {
        identityId: row.id,
        memoryId: row.id,
        message: 'Memory saved successfully',
        success: true,
      };
    } catch (error) {
      return this.failure(error);
    }
  };

  private identity = async (id: string) => {
    const [row] = await this.db
      .select()
      .from(agentEvalMemories)
      .where(
        and(
          attemptWhere(this.options.userId, this.options.reference),
          eq(agentEvalMemories.id, id),
          eq(agentEvalMemories.layer, 'identity'),
        ),
      )
      .limit(1);
    return row;
  };

  updateIdentityMemory = async (
    input: z.output<typeof UpdateIdentityToolInputSchema>,
  ): Promise<UpdateIdentityMemoryResult> => {
    try {
      const row = await this.identity(input.id);
      if (!row) return { message: `Identity memory ${input.id} not found`, success: false };
      const set = (input.set ?? {}) as Payload;
      const replace = String(input.mergeStrategy).toLowerCase() === 'replace';
      const payload = replace
        ? ((set.withIdentity ?? {}) as Record<string, unknown>)
        : { ...row.payload, ...set.withIdentity };
      const next: EvalMemoryDraft = {
        details: set.details ?? (replace ? null : row.details),
        layer: 'identity',
        memoryCategory: set.memoryCategory ?? (replace ? null : row.memoryCategory),
        memoryType: set.memoryType ?? (replace ? null : row.memoryType),
        payload,
        summary: set.summary ?? (replace ? null : row.summary),
        tags: Array.isArray(set.tags) ? set.tags : replace ? null : row.tags,
        title: set.title ?? (replace ? null : row.title),
      };
      const [embedding] = await this.options.embed([semanticText(next)]);
      await this.db
        .update(agentEvalMemories)
        .set({ ...next, embedding: embedding ?? row.embedding, updatedAt: new Date() })
        .where(eq(agentEvalMemories.id, row.id));
      return { identityId: row.id, message: 'Identity memory updated', success: true };
    } catch (error) {
      return this.failure(error);
    }
  };

  removeIdentityMemory = async (
    input: z.infer<typeof RemoveIdentityActionSchema>,
  ): Promise<RemoveIdentityMemoryResult> => {
    try {
      const row = await this.identity(input.id);
      if (!row) return { message: `Identity memory ${input.id} not found`, success: false };
      await this.db
        .update(agentEvalMemories)
        .set({ removedReason: input.reason || 'removed', updatedAt: new Date() })
        .where(eq(agentEvalMemories.id, row.id));
      return {
        identityId: row.id,
        message: 'Identity memory removed',
        reason: input.reason,
        success: true,
      };
    } catch (error) {
      return this.failure(error);
    }
  };
}
