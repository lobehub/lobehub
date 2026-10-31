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
  EvalMemoryLayer,
  EvalMemoryReference,
  QueryTaxonomyOptionsParams,
  QueryTaxonomyOptionsResult,
  RemoveIdentityMemoryResult,
  SearchMemoryParams,
  SearchMemoryResult,
  UpdateIdentityMemoryResult,
} from '@lobechat/types';
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import { normalizeUserMemorySearchQueries } from '@/database/models/userMemory';
import { agentEvalMemories, type AgentEvalMemoryItem } from '@/database/schemas';
import { getEvalAttemptId } from '@/server/services/agentEvalRun/utils';
import {
  type MemorySearchEffort,
  normalizeSearchMemoryParams,
  resolveMemorySearchTopK,
} from '@/server/services/memory/userMemory/searchParams';

import type { EvalMemoryEmbedder } from './embedding';
import { draftOf, draftText, type EvalMemoryDraft } from './entries';

/** Rows of one attempt owned by this caller; removed entries stay out unless asked for. */
export const attemptWhere = (
  userId: string,
  reference: Pick<EvalMemoryReference, 'runId' | 'threadId' | 'topicId'>,
  options: { includeRemoved?: boolean } = {},
): SQL =>
  and(
    eq(agentEvalMemories.userId, userId),
    eq(agentEvalMemories.runId, reference.runId),
    eq(agentEvalMemories.topicId, reference.topicId),
    reference.threadId
      ? eq(agentEvalMemories.threadId, reference.threadId)
      : isNull(agentEvalMemories.threadId),
    options.includeRemoved ? undefined : isNull(agentEvalMemories.removedReason),
  ) as SQL;

type Payload = Record<string, any>;

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const overlaps = (wanted: string[] | undefined, have: string[]) =>
  !wanted?.length || wanted.some((w) => have.includes(w));

const matchesOne = (wanted: string[] | undefined, value: unknown) =>
  !wanted?.length || (typeof value === 'string' && wanted.includes(value));

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
};

const lexical = (haystack: string, queries: string[]) => {
  const tokens = queries
    .flatMap((q) => q.toLowerCase().split(/[^\p{L}\p{N}]+/u))
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return 0;
  const text = haystack.toLowerCase();
  return tokens.filter((t) => text.includes(t)).length / tokens.length;
};

const LAYERS: Record<Exclude<EvalMemoryLayer, 'persona'>, keyof SearchMemoryResult> = {
  activity: 'activities',
  context: 'contexts',
  experience: 'experiences',
  identity: 'identities',
  preference: 'preferences',
};

/**
 * The Memory tool of an eval attempt. Same surface as the account's Memory
 * runtime, backed by the attempt's own rows: the fixture it was seeded with
 * plus what the Agent writes during the attempt. Search embeds the queries
 * with the account's embedding model and ranks the attempt's entries by
 * similarity (lexically when an embedding is missing); facets and time
 * ranges filter the same way the native search does.
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
    const [embedding] = await this.options.embed([draftText(draft)]);
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
    const limits = resolveMemorySearchTopK(
      (normalized.effort as MemorySearchEffort | undefined) ?? this.options.memoryEffort,
      normalized,
    );
    const wantedLayers = normalized.layers?.length
      ? new Set(normalized.layers.map(String))
      : undefined;
    const range = normalized.timeRange;

    const rows = (await this.rows()).filter((row) => {
      if (row.layer === 'persona') return false;
      if (wantedLayers && !wantedLayers.has(row.layer)) return false;
      const p = row.payload as Payload;
      if (!matchesOne(normalized.types, row.memoryType ?? p.type)) return false;
      if (!matchesOne(normalized.categories, row.memoryCategory)) return false;
      if (!overlaps(normalized.tags, asList(row.tags))) return false;
      if (!overlaps(normalized.labels, [...asList(p.extractedLabels), ...asList(p.labels)]))
        return false;
      if (!matchesOne(normalized.status, p.currentStatus ?? p.status)) return false;
      if (!matchesOne(normalized.relationships, p.relationship)) return false;
      if (range?.start && row.capturedAt < range.start) return false;
      if (range?.end && row.capturedAt > range.end) return false;
      return true;
    });

    const scored = rows
      .map((row) => {
        const score =
          queries.length === 0
            ? 1
            : queryEmbeddings.length > 0 && row.embedding
              ? Math.max(...queryEmbeddings.map((q) => cosine(q, row.embedding!)))
              : lexical(draftText(row), queries);
        return { row, score };
      })
      // With embeddings every entry ranks; without them only lexical hits do.
      .filter((item) => queryEmbeddings.length > 0 || item.score > 0)
      .sort((a, b) => b.score - a.score || b.row.capturedAt.getTime() - a.row.capturedAt.getTime());

    const take = (layer: Exclude<EvalMemoryLayer, 'persona'>, limit: number) => {
      const all = scored.filter((item) => item.row.layer === layer);
      const items = all.slice(0, limit).map((item) => toSearchItem(item.row));
      return {
        items,
        meta: { hasMore: all.length > items.length, returned: items.length, total: all.length },
      };
    };
    const activities = take('activity', limits.activities);
    const contexts = take('context', limits.contexts);
    const experiences = take('experience', limits.experiences);
    const identities = take('identity', limits.identities);
    const preferences = take('preference', limits.preferences);
    const { effort: _effort, topK: _topK, ...appliedFilters } = normalized;

    return {
      activities: activities.items as SearchMemoryResult['activities'],
      contexts: contexts.items as SearchMemoryResult['contexts'],
      experiences: experiences.items as SearchMemoryResult['experiences'],
      identities: identities.items as SearchMemoryResult['identities'],
      meta: {
        appliedFilters,
        appliedQueries: queries,
        layers: {
          activities: activities.meta,
          contexts: contexts.meta,
          experiences: experiences.meta,
          identities: identities.meta,
          preferences: preferences.meta,
        },
      },
      preferences: preferences.items as SearchMemoryResult['preferences'],
    };
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
      const [embedding] = await this.options.embed([draftText(next)]);
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

/** An attempt row in the shape the Memory tool's search result (and its formatter) expects. */
const toSearchItem = (row: AgentEvalMemoryItem): Record<string, unknown> => {
  const p = row.payload as Payload;
  const stamps = {
    accessedAt: row.capturedAt,
    createdAt: row.capturedAt,
    updatedAt: row.capturedAt,
  };
  const tags = row.tags ?? asList(p.tags);
  switch (row.layer) {
    case 'preference': {
      return {
        ...stamps,
        conclusionDirectives: p.conclusionDirectives ?? row.summary ?? null,
        id: row.id,
        metadata: {
          appContext: p.appContext ?? null,
          extractedScopes: p.extractedScopes ?? null,
          originContext: p.originContext ?? null,
        },
        scorePriority: p.scorePriority ?? null,
        suggestions: Array.isArray(p.suggestions)
          ? p.suggestions.join('\n')
          : (p.suggestions ?? null),
        tags,
        type: p.type ?? row.memoryType ?? null,
        userMemoryId: row.id,
      };
    }
    case 'context': {
      return {
        ...stamps,
        associatedObjects: p.associatedObjects ?? null,
        associatedSubjects: p.associatedSubjects ?? null,
        currentStatus: p.currentStatus ?? null,
        description: p.description ?? row.summary ?? null,
        id: row.id,
        metadata: {},
        scoreImpact: p.scoreImpact ?? null,
        scoreUrgency: p.scoreUrgency ?? null,
        tags,
        title: p.title ?? row.title ?? null,
        type: p.type ?? null,
        userMemoryIds: [row.id],
      };
    }
    case 'activity': {
      return {
        ...stamps,
        associatedLocations: p.associatedLocations ?? null,
        associatedObjects: p.associatedObjects ?? null,
        associatedSubjects: p.associatedSubjects ?? null,
        endsAt: toDate(p.endsAt),
        feedback: p.feedback ?? null,
        id: row.id,
        metadata: p.metadata ?? null,
        narrative: p.narrative ?? row.summary ?? null,
        notes: p.notes ?? null,
        startsAt: toDate(p.startsAt),
        status: p.status ?? null,
        tags,
        timezone: p.timezone ?? null,
        type: p.type ?? null,
        userMemoryId: row.id,
      };
    }
    case 'experience': {
      return {
        ...stamps,
        action: p.action ?? null,
        id: row.id,
        keyLearning: p.keyLearning ?? null,
        metadata: null,
        possibleOutcome: p.possibleOutcome ?? null,
        reasoning: p.reasoning ?? null,
        scoreConfidence: p.scoreConfidence ?? null,
        situation: p.situation ?? row.summary ?? null,
        tags,
        type: p.type ?? row.memoryType ?? null,
        userMemoryId: row.id,
      };
    }
    default: {
      return {
        ...stamps,
        description: p.description ?? row.summary ?? null,
        episodicDate: toDate(p.episodicDate),
        id: row.id,
        metadata: {
          ...(p.extractedLabels && { extractedLabels: p.extractedLabels }),
          ...(p.scoreConfidence !== undefined && { scoreConfidence: p.scoreConfidence }),
          ...(p.sourceEvidence !== undefined && { sourceEvidence: p.sourceEvidence }),
        },
        relationship: p.relationship ?? null,
        role: p.role ?? null,
        tags,
        type: p.type ?? row.memoryType ?? null,
        userMemoryId: row.id,
      };
    }
  }
};

export { LAYERS as EVAL_MEMORY_RESULT_LAYERS };
