import type { SQL } from 'drizzle-orm';
import { and, arrayContains, eq, gte, inArray, isNull, lte, not, or, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import {
  agents,
  chatGroups,
  messages,
  topics,
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
  userPersonaDocuments,
} from '../../../schemas';
import { buildWorkspaceWhere } from '../../../utils/workspace';
import type {
  FtsSearchBackendCandidate,
  FtsSearchBackendEntity,
  FtsSearchBackendFilters,
  FtsSearchBackendRequest,
  FtsSearchBackendResponse,
  FtsSearchBackendScope,
} from '../types';
import type { PgFtsSearchField } from './dialect';
import type { PgSearchFtsSearchContext } from './scope';

/**
 * Bounded candidate requests over-fetch so authorization hydration can still fill
 * the requested page; matches the Elasticsearch candidate multiplier.
 */
const CANDIDATE_MULTIPLIER = 4;

type MemoryTimeField = NonNullable<
  NonNullable<FtsSearchBackendFilters['memoryTimeRange']>['field']
>;

type MemoryTimeColumns = Partial<Record<MemoryTimeField, AnyPgColumn>>;

interface CandidateTarget {
  /** Field names used when the request does not narrow `query.fields`. */
  defaultFields: string[];
  /** Elasticsearch document field name → searchable columns backing it. */
  fields: Record<string, PgFtsSearchField[]>;
  id: AnyPgColumn;
  /** Join predicate for layer tables whose document embeds parent memory text. */
  parentJoin?: SQL;
  table: PgTable;
  where: (scope: FtsSearchBackendScope, filters: FtsSearchBackendFilters) => (SQL | undefined)[];
}

const parentMemoryFields = {
  parent_details: [{ column: userMemories.details }],
  parent_summary: [{ column: userMemories.summary }],
  parent_title: [{ column: userMemories.title, weight: 4 }],
} satisfies Record<string, PgFtsSearchField[]>;

const parentMemoryJoin = (layer: { userId: AnyPgColumn; userMemoryId: AnyPgColumn }): SQL =>
  and(eq(userMemories.id, layer.userMemoryId), eq(userMemories.userId, layer.userId)) as SQL;

/**
 * Mirrors the Elasticsearch tag clause: each requested tag may come from the
 * layer row or its parent memory, and a layer whose parent carries no tags is not
 * excluded. `all` requires every tag (AND of per-tag clauses); `any` requires one.
 *
 * The search document stores an untagged parent as an empty `parent_tags` array,
 * which Elasticsearch treats as a missing field, so an empty SQL array counts as
 * "no parent tags" too.
 */
const memoryTagFilter = (
  layerTags: AnyPgColumn,
  parentTags: AnyPgColumn | undefined,
  filters: FtsSearchBackendFilters,
): SQL | undefined => {
  const tags = filters.memoryTags;
  if (!tags?.length) return;

  const clauses = tags.map((tag) =>
    parentTags
      ? (or(
          arrayContains(layerTags, [tag]),
          arrayContains(parentTags, [tag]),
          sql`coalesce(cardinality(${parentTags}), 0) = 0`,
        ) as SQL)
      : arrayContains(layerTags, [tag]),
  );

  return (filters.memoryTagMatch === 'any' ? or(...clauses) : and(...clauses)) as SQL;
};

/**
 * Bounded candidate pools are cut by score before hydration, so the time range
 * must narrow the pool here as well; otherwise higher-scoring rows outside the
 * range could exhaust it. A field the table does not store is left to hydration.
 */
const memoryTimeFilter = (
  columns: MemoryTimeColumns | undefined,
  filters: FtsSearchBackendFilters,
): SQL | undefined => {
  const range = filters.memoryTimeRange;
  const column = columns?.[range?.field ?? 'capturedAt'];
  if (!range || !column) return;

  return and(
    range.start ? gte(column, range.start) : undefined,
    range.end ? lte(column, range.end) : undefined,
  );
};

const memoryTimeColumns = (
  table: { capturedAt: AnyPgColumn; createdAt: AnyPgColumn; updatedAt: AnyPgColumn },
  extra: MemoryTimeColumns = {},
): MemoryTimeColumns => ({
  capturedAt: table.capturedAt,
  createdAt: table.createdAt,
  updatedAt: table.updatedAt,
  ...extra,
});

/**
 * Topic-scope pruning for topics and messages, mirroring Elasticsearch. Topics
 * own their scope columns; topic-bound messages may carry only `topic_id`, so a
 * missing message scope column must survive until PostgreSQL applies the
 * authoritative parent-topic scope.
 */
const topicScopeWhere = (
  table: { agentId: AnyPgColumn; groupId: AnyPgColumn; sessionId: AnyPgColumn },
  filters: FtsSearchBackendFilters,
  legacyMissingAllowed: boolean,
): (SQL | undefined)[] => {
  const exactOrMissing = (column: AnyPgColumn, value: string) =>
    legacyMissingAllowed ? (or(eq(column, value), isNull(column)) as SQL) : eq(column, value);
  const scope = filters.topicScope;
  const clauses: (SQL | undefined)[] = [
    filters.agentId ? eq(table.agentId, filters.agentId) : undefined,
  ];

  if (scope?.groupId) {
    clauses.push(exactOrMissing(table.groupId, scope.groupId));
  } else if (scope?.agentId) {
    clauses.push(exactOrMissing(table.agentId, scope.agentId));
  } else if (scope?.containerId) {
    clauses.push(
      or(
        eq(table.sessionId, scope.containerId),
        eq(table.groupId, scope.containerId),
        legacyMissingAllowed ? and(isNull(table.sessionId), isNull(table.groupId)) : undefined,
      ) as SQL,
    );
  }

  return clauses;
};

/**
 * Memory-layer filters mirrored from the Elasticsearch candidate query. Every
 * consumer re-applies its filters in PostgreSQL, but bounded pools are cut by
 * score first, so every filter Elasticsearch applies is applied here too.
 */
const memoryLayerWhere =
  (layer: {
    relationship?: AnyPgColumn;
    status?: AnyPgColumn;
    tags: AnyPgColumn;
    timeColumns: MemoryTimeColumns;
    type?: AnyPgColumn;
    userId: AnyPgColumn;
  }) =>
  (scope: FtsSearchBackendScope, filters: FtsSearchBackendFilters): (SQL | undefined)[] => [
    eq(layer.userId, scope.userId),
    filters.memoryCategories?.length
      ? inArray(userMemories.memoryCategory, filters.memoryCategories)
      : undefined,
    layer.type && filters.memoryTypes?.length
      ? inArray(layer.type, filters.memoryTypes)
      : undefined,
    layer.relationship && filters.memoryRelationships?.length
      ? inArray(layer.relationship, filters.memoryRelationships)
      : undefined,
    layer.status && filters.memoryStatus?.length
      ? inArray(layer.status, filters.memoryStatus)
      : undefined,
    memoryTagFilter(layer.tags, userMemories.tags, filters),
    memoryTimeFilter(layer.timeColumns, filters),
  ];

const CANDIDATE_TARGETS: Record<FtsSearchBackendEntity, CandidateTarget | undefined> = {
  agents: {
    defaultFields: ['title', 'slug', 'tags', 'description', 'system_role'],
    fields: {
      description: [{ column: agents.description, weight: 2 }],
      slug: [{ column: agents.slug, weight: 4 }],
      system_role: [{ column: agents.systemRole }],
      tags: [{ column: agents.tags, jsonb: true, weight: 3 }],
      title: [{ column: agents.title, weight: 5 }],
    },
    id: agents.id,
    table: agents,
    where: (scope, filters) => [
      buildWorkspaceWhere(scope, agents),
      filters.excludeVirtual ? not(eq(agents.virtual, true)) : undefined,
    ],
  },
  chatGroups: {
    defaultFields: ['title', 'description', 'content'],
    fields: {
      content: [{ column: chatGroups.content }],
      description: [{ column: chatGroups.description, weight: 2 }],
      title: [{ column: chatGroups.title, weight: 4 }],
    },
    id: chatGroups.id,
    table: chatGroups,
    where: (scope) => [buildWorkspaceWhere(scope, chatGroups)],
  },
  documents: undefined,
  files: undefined,
  knowledgeBases: undefined,
  memoryActivities: {
    defaultFields: [
      'parent_title',
      'parent_summary',
      'parent_details',
      'narrative',
      'notes',
      'feedback',
    ],
    fields: {
      ...parentMemoryFields,
      feedback: [{ column: userMemoriesActivities.feedback }],
      narrative: [{ column: userMemoriesActivities.narrative }],
      notes: [{ column: userMemoriesActivities.notes }],
    },
    id: userMemoriesActivities.id,
    parentJoin: parentMemoryJoin(userMemoriesActivities),
    table: userMemoriesActivities,
    where: memoryLayerWhere({
      ...userMemoriesActivities,
      timeColumns: memoryTimeColumns(userMemoriesActivities, {
        endsAt: userMemoriesActivities.endsAt,
        startsAt: userMemoriesActivities.startsAt,
      }),
    }),
  },
  memoryContexts: {
    defaultFields: ['parent_text', 'title', 'description', 'current_status'],
    fields: {
      current_status: [{ column: userMemoriesContexts.currentStatus }],
      description: [{ column: userMemoriesContexts.description }],
      parent_text: [
        { column: userMemories.title },
        { column: userMemories.summary },
        { column: userMemories.details },
      ],
      title: [{ column: userMemoriesContexts.title, weight: 2 }],
    },
    id: userMemoriesContexts.id,
    // Contexts link to several parents through a jsonb id list instead of a
    // scalar foreign key; jsonb key existence keeps the GIN index usable.
    parentJoin: and(
      eq(userMemories.userId, userMemoriesContexts.userId),
      sql`COALESCE(${userMemoriesContexts.userMemoryIds}, '[]'::jsonb) ? (${userMemories.id})::text`,
    ) as SQL,
    table: userMemoriesContexts,
    where: memoryLayerWhere({
      status: userMemoriesContexts.currentStatus,
      tags: userMemoriesContexts.tags,
      timeColumns: memoryTimeColumns(userMemoriesContexts),
      type: userMemoriesContexts.type,
      userId: userMemoriesContexts.userId,
    }),
  },
  memoryExperiences: {
    defaultFields: [
      'parent_title',
      'parent_summary',
      'parent_details',
      'situation',
      'reasoning',
      'possible_outcome',
      'action',
      'key_learning',
    ],
    fields: {
      ...parentMemoryFields,
      action: [{ column: userMemoriesExperiences.action }],
      key_learning: [{ column: userMemoriesExperiences.keyLearning }],
      possible_outcome: [{ column: userMemoriesExperiences.possibleOutcome }],
      reasoning: [{ column: userMemoriesExperiences.reasoning }],
      situation: [{ column: userMemoriesExperiences.situation }],
    },
    id: userMemoriesExperiences.id,
    parentJoin: parentMemoryJoin(userMemoriesExperiences),
    table: userMemoriesExperiences,
    where: memoryLayerWhere({
      ...userMemoriesExperiences,
      timeColumns: memoryTimeColumns(userMemoriesExperiences),
    }),
  },
  memoryIdentities: {
    defaultFields: ['parent_title', 'parent_summary', 'parent_details', 'description', 'role'],
    fields: {
      ...parentMemoryFields,
      description: [{ column: userMemoriesIdentities.description }],
      role: [{ column: userMemoriesIdentities.role }],
    },
    id: userMemoriesIdentities.id,
    parentJoin: parentMemoryJoin(userMemoriesIdentities),
    table: userMemoriesIdentities,
    where: memoryLayerWhere({
      ...userMemoriesIdentities,
      timeColumns: memoryTimeColumns(userMemoriesIdentities, {
        episodicDate: userMemoriesIdentities.episodicDate,
      }),
    }),
  },
  memoryPreferences: {
    defaultFields: [
      'parent_title',
      'parent_summary',
      'parent_details',
      'conclusion_directives',
      'suggestions',
    ],
    fields: {
      ...parentMemoryFields,
      conclusion_directives: [{ column: userMemoriesPreferences.conclusionDirectives }],
      suggestions: [{ column: userMemoriesPreferences.suggestions }],
    },
    id: userMemoriesPreferences.id,
    parentJoin: parentMemoryJoin(userMemoriesPreferences),
    table: userMemoriesPreferences,
    where: memoryLayerWhere({
      ...userMemoriesPreferences,
      timeColumns: memoryTimeColumns(userMemoriesPreferences),
    }),
  },
  messages: {
    defaultFields: ['content', 'summary'],
    fields: {
      content: [{ column: messages.content, weight: 2 }],
      summary: [{ column: messages.summary }],
    },
    id: messages.id,
    table: messages,
    where: (scope, filters) => [
      buildWorkspaceWhere(scope, messages),
      ...topicScopeWhere(messages, filters, true),
    ],
  },
  personaDocuments: {
    defaultFields: ['tagline', 'persona'],
    fields: {
      persona: [{ column: userPersonaDocuments.persona }],
      tagline: [{ column: userPersonaDocuments.tagline }],
    },
    id: userPersonaDocuments.id,
    table: userPersonaDocuments,
    where: (scope, filters) => [
      eq(userPersonaDocuments.userId, scope.userId),
      memoryTimeFilter(memoryTimeColumns(userPersonaDocuments), filters),
    ],
  },
  topics: {
    defaultFields: ['title', 'content', 'description'],
    fields: {
      content: [{ column: topics.content }],
      description: [{ column: topics.description }],
      title: [{ column: topics.title, weight: 2 }],
    },
    id: topics.id,
    table: topics,
    where: (scope, filters) => [
      buildWorkspaceWhere(scope, topics),
      ...topicScopeWhere(topics, filters, false),
    ],
  },
  userMemories: {
    defaultFields: ['title', 'summary', 'details'],
    fields: {
      details: [{ column: userMemories.details }],
      summary: [{ column: userMemories.summary, weight: 2 }],
      title: [{ column: userMemories.title, weight: 4 }],
    },
    id: userMemories.id,
    table: userMemories,
    where: (scope, filters) => [
      eq(userMemories.userId, scope.userId),
      filters.memoryCategories?.length
        ? inArray(userMemories.memoryCategory, filters.memoryCategories)
        : undefined,
      filters.memoryTypes?.length
        ? inArray(userMemories.memoryType, filters.memoryTypes)
        : undefined,
      filters.memoryStatus?.length ? inArray(userMemories.status, filters.memoryStatus) : undefined,
      memoryTagFilter(userMemories.tags, undefined, filters),
      memoryTimeFilter(memoryTimeColumns(userMemories), filters),
    ],
  },
};

/** Requested field names may carry Elasticsearch boost suffixes such as `title^5`. */
const resolveFields = (target: CandidateTarget, requested?: string[]): PgFtsSearchField[] => {
  const names = (requested?.length ? requested : target.defaultFields).map(
    (name) => name.split('^')[0],
  );
  const fields = names.flatMap((name) => target.fields[name] ?? []);

  return fields.length > 0
    ? fields
    : target.defaultFields.flatMap((name) => target.fields[name] ?? []);
};

/**
 * Candidate-only retrieval for model paths that hydrate and re-authorize the ids
 * themselves. Returns ids ordered by the dialect score; `items` stays empty.
 */
export async function searchCandidates(
  context: PgSearchFtsSearchContext,
  request: FtsSearchBackendRequest,
): Promise<FtsSearchBackendResponse> {
  const target = CANDIDATE_TARGETS[request.entity];
  if (!target)
    throw new Error(`Unsupported ${context.dialect.key} candidate entity: ${request.entity}`);

  const { db, dialect } = context;
  const preparedQuery = dialect.prepare(request.query.text);
  const fields = resolveFields(target, request.query.fields);
  const rowScore = dialect.score(target.id, fields, preparedQuery);
  // A multi-parent join (memory contexts) repeats a row per matching parent, so
  // collapse to one row per id with its best score before any limit applies;
  // otherwise one heavily linked row could fill the whole bounded pool.
  const score = target.parentJoin ? sql<number>`max(${rowScore})` : rowScore;
  let query = db.select({ id: target.id, score }).from(target.table).$dynamic();
  if (target.parentJoin) {
    query = query.leftJoin(userMemories, target.parentJoin).groupBy(target.id);
  }
  query = query
    .where(
      and(...target.where(request.scope, request.filters), dialect.match(fields, preparedQuery)),
    )
    .orderBy(sql`${score} DESC`);
  // An omitted limit is the unbounded contract: consumers filter and order the
  // whole candidate set themselves, so no cap may hide matches from them.
  if (request.pagination.limit)
    query = query.limit(request.pagination.limit * CANDIDATE_MULTIPLIER);

  const rows = await query;
  const candidates: FtsSearchBackendCandidate[] = rows.map((row) => ({
    id: String(row.id),
    score: row.score,
  }));

  return { candidates, items: [], total: candidates.length };
}
