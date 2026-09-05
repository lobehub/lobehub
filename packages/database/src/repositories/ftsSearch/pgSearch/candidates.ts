import type { SQL } from 'drizzle-orm';
import { and, arrayContains, arrayOverlaps, eq, inArray, not, or, sql } from 'drizzle-orm';
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

/**
 * Unbounded candidate requests are consumed as id lists that PostgreSQL filters
 * and orders again, so a generous cap protects the bind payload without
 * changing results for the small deployments this provider targets.
 */
const UNBOUNDED_CANDIDATE_LIMIT = 5000;

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

const memoryTagFilter = (
  columns: AnyPgColumn[],
  filters: FtsSearchBackendFilters,
): SQL | undefined => {
  if (!filters.memoryTags?.length) return;

  // Layer rows carry their own tags and inherit the parent memory tags in the
  // search document; either source satisfies the filter, mirroring Elasticsearch.
  const compare = filters.memoryTagMatch === 'any' ? arrayOverlaps : arrayContains;
  return or(...columns.map((column) => compare(column, filters.memoryTags!))) as SQL;
};

/**
 * Memory-layer filters mirrored from the Elasticsearch candidate query. Every
 * consumer re-applies its filters in PostgreSQL, so these only keep the candidate
 * pool relevant; `memoryTimeRange` and `topicScope` are intentionally left to the
 * consuming query.
 */
const memoryLayerWhere =
  (layer: {
    relationship?: AnyPgColumn;
    status?: AnyPgColumn;
    tags: AnyPgColumn;
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
    memoryTagFilter([layer.tags, userMemories.tags], filters),
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
    where: memoryLayerWhere(userMemoriesActivities),
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
    where: memoryLayerWhere(userMemoriesExperiences),
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
    where: memoryLayerWhere(userMemoriesIdentities),
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
    where: memoryLayerWhere(userMemoriesPreferences),
  },
  messages: {
    defaultFields: ['content', 'summary'],
    fields: {
      content: [{ column: messages.content, weight: 2 }],
      summary: [{ column: messages.summary }],
    },
    id: messages.id,
    table: messages,
    where: (scope) => [buildWorkspaceWhere(scope, messages)],
  },
  personaDocuments: {
    defaultFields: ['tagline', 'persona'],
    fields: {
      persona: [{ column: userPersonaDocuments.persona }],
      tagline: [{ column: userPersonaDocuments.tagline }],
    },
    id: userPersonaDocuments.id,
    table: userPersonaDocuments,
    where: (scope) => [eq(userPersonaDocuments.userId, scope.userId)],
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
    where: (scope) => [buildWorkspaceWhere(scope, topics)],
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
      memoryTagFilter([userMemories.tags], filters),
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
  const score = dialect.score(target.id, fields, preparedQuery);
  const limit = request.pagination.limit
    ? request.pagination.limit * CANDIDATE_MULTIPLIER
    : UNBOUNDED_CANDIDATE_LIMIT;

  const query = db.select({ id: target.id, score }).from(target.table).$dynamic();
  const rows = await (target.parentJoin ? query.leftJoin(userMemories, target.parentJoin) : query)
    .where(
      and(...target.where(request.scope, request.filters), dialect.match(fields, preparedQuery)),
    )
    .orderBy(sql`${score} DESC`)
    .limit(limit);

  // A multi-parent join (memory contexts) can repeat a row; keep the best-scored one.
  const candidates = new Map<string, FtsSearchBackendCandidate>();
  for (const row of rows) {
    const id = String(row.id);
    if (!candidates.has(id)) candidates.set(id, { id, score: row.score });
  }

  return { candidates: [...candidates.values()], items: [], total: candidates.size };
}
