import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';

import {
  agents,
  chatGroups,
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  messages,
  topics,
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
  userPersonaDocuments,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type {
  FtsSearchBuiltDocument,
  FtsSearchDocumentEntity,
  FtsSearchDocumentKey,
  FtsSearchDocumentSourceMap,
} from './schema';
import { FTS_SEARCH_DOCUMENT_ENTITIES, parseFtsSearchDocumentSource } from './schema';

interface FtsSearchDocumentSelection {
  afterId?: string;
  ids?: string[];
  limit: number;
}

export interface FtsSearchDocumentBatchOptions {
  afterId?: string;
  limit: number;
}

export type FtsSearchDocumentRelationChange =
  | { fileIds: readonly string[]; relation: 'knowledgeBaseFiles' }
  | { memoryIds: readonly string[]; relation: 'userMemoryReferences' };

const entityOrder = new Map(FTS_SEARCH_DOCUMENT_ENTITIES.map((entity, index) => [entity, index]));

const normalizeIds = (ids: readonly string[]) => [...new Set(ids)].filter(Boolean).sort();

const normalizeStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      return JSON.stringify(item) ?? String(item);
    });
  }
  if (typeof value === 'string') return [value];
  if (value === null || value === undefined) return [];
  return [JSON.stringify(value) ?? String(value)];
};

const toDateTime = (value: Date) => value.toISOString();
const toNullableDateTime = (value: Date | null) => value?.toISOString() ?? null;

const groupKnowledgeBaseIds = (
  rows: { fileId: string; knowledgeBaseId: string }[],
): Map<string, string[]> => {
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = grouped.get(row.fileId) ?? new Set<string>();
    ids.add(row.knowledgeBaseId);
    grouped.set(row.fileId, ids);
  }

  return new Map([...grouped.entries()].map(([fileId, ids]) => [fileId, [...ids].sort()] as const));
};

const compareKeys = (left: FtsSearchDocumentKey, right: FtsSearchDocumentKey) => {
  const entityDifference =
    (entityOrder.get(left.entity) ?? Number.MAX_SAFE_INTEGER) -
    (entityOrder.get(right.entity) ?? Number.MAX_SAFE_INTEGER);
  return entityDifference || left.id.localeCompare(right.id);
};

const dedupeKeys = (keys: FtsSearchDocumentKey[]) =>
  [...new Map(keys.map((key) => [`${key.entity}:${key.id}`, key])).values()].sort(compareKeys);

/**
 * Canonical PostgreSQL → search projection builder.
 *
 * This repository is intentionally actor-agnostic: backfill, incremental sync, and reconciliation
 * need the complete source-of-truth projection. Product reads must continue to use FtsSearchRepo,
 * whose provider hydration reapplies authorization.
 */
export class FtsSearchDocumentBuilder {
  constructor(private db: LobeChatDatabase) {}

  async buildBatch(
    entity: FtsSearchDocumentEntity,
    { afterId, limit }: FtsSearchDocumentBatchOptions,
  ): Promise<FtsSearchBuiltDocument[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('FTS search document batch limit must be a positive integer');
    }

    return this.build(entity, { afterId, limit });
  }

  async buildByIds(
    entity: FtsSearchDocumentEntity,
    sourceIds: readonly string[],
  ): Promise<FtsSearchBuiltDocument[]> {
    const ids = normalizeIds(sourceIds);
    if (ids.length === 0) return [];

    return this.build(entity, { ids, limit: ids.length });
  }

  /**
   * Keep these relation fanout rules aligned with the FTS search-sync trigger functions in the
   * database migration. This method remains the application-side source for backfills and repair.
   */
  async resolveAffectedKeys(
    change: FtsSearchDocumentRelationChange,
  ): Promise<FtsSearchDocumentKey[]> {
    if (change.relation === 'knowledgeBaseFiles') {
      const fileIds = normalizeIds(change.fileIds);
      if (fileIds.length === 0) return [];

      const linkedDocuments = await this.db
        .select({ id: documents.id })
        .from(documents)
        .where(inArray(documents.fileId, fileIds));

      return dedupeKeys([
        ...fileIds.map((id): FtsSearchDocumentKey => ({ entity: 'files', id })),
        ...linkedDocuments.map(({ id }): FtsSearchDocumentKey => ({ entity: 'documents', id })),
      ]);
    }

    const memoryIds = normalizeIds(change.memoryIds);
    if (memoryIds.length === 0) return [];

    const contextPredicates = memoryIds.map(
      (memoryId) =>
        sql`${userMemoriesContexts.userMemoryIds} @> ${JSON.stringify([memoryId])}::jsonb`,
    );
    const [contexts, preferences, activities, identities, experiences] = await Promise.all([
      this.db
        .select({ id: userMemoriesContexts.id })
        .from(userMemoriesContexts)
        .where(or(...contextPredicates)),
      this.db
        .select({ id: userMemoriesPreferences.id })
        .from(userMemoriesPreferences)
        .where(inArray(userMemoriesPreferences.userMemoryId, memoryIds)),
      this.db
        .select({ id: userMemoriesActivities.id })
        .from(userMemoriesActivities)
        .where(inArray(userMemoriesActivities.userMemoryId, memoryIds)),
      this.db
        .select({ id: userMemoriesIdentities.id })
        .from(userMemoriesIdentities)
        .where(inArray(userMemoriesIdentities.userMemoryId, memoryIds)),
      this.db
        .select({ id: userMemoriesExperiences.id })
        .from(userMemoriesExperiences)
        .where(inArray(userMemoriesExperiences.userMemoryId, memoryIds)),
    ]);

    return dedupeKeys([
      ...memoryIds.map((id): FtsSearchDocumentKey => ({ entity: 'userMemories', id })),
      ...contexts.map(({ id }): FtsSearchDocumentKey => ({ entity: 'memoryContexts', id })),
      ...preferences.map(({ id }): FtsSearchDocumentKey => ({ entity: 'memoryPreferences', id })),
      ...activities.map(({ id }): FtsSearchDocumentKey => ({ entity: 'memoryActivities', id })),
      ...identities.map(({ id }): FtsSearchDocumentKey => ({ entity: 'memoryIdentities', id })),
      ...experiences.map(({ id }): FtsSearchDocumentKey => ({ entity: 'memoryExperiences', id })),
    ]);
  }

  private createDocument<Entity extends FtsSearchDocumentEntity>(
    entity: Entity,
    input: unknown,
  ): Extract<FtsSearchBuiltDocument, { entity: Entity }> {
    const source = parseFtsSearchDocumentSource(entity, input);
    return { entity, id: source.id, source } as Extract<FtsSearchBuiltDocument, { entity: Entity }>;
  }

  private async build(
    entity: FtsSearchDocumentEntity,
    selection: FtsSearchDocumentSelection,
  ): Promise<FtsSearchBuiltDocument[]> {
    switch (entity) {
      case 'agents': {
        return this.buildAgents(selection);
      }
      case 'topics': {
        return this.buildTopics(selection);
      }
      case 'files': {
        return this.buildFiles(selection);
      }
      case 'knowledgeBases': {
        return this.buildKnowledgeBases(selection);
      }
      case 'userMemories': {
        return this.buildUserMemories(selection);
      }
      case 'chatGroups': {
        return this.buildChatGroups(selection);
      }
      case 'memoryContexts': {
        return this.buildMemoryContexts(selection);
      }
      case 'memoryPreferences': {
        return this.buildMemoryPreferences(selection);
      }
      case 'memoryActivities': {
        return this.buildMemoryActivities(selection);
      }
      case 'memoryIdentities': {
        return this.buildMemoryIdentities(selection);
      }
      case 'memoryExperiences': {
        return this.buildMemoryExperiences(selection);
      }
      case 'personaDocuments': {
        return this.buildPersonaDocuments(selection);
      }
      case 'documents': {
        return this.buildDocuments(selection);
      }
      case 'messages': {
        return this.buildMessages(selection);
      }
    }
  }

  private async buildAgents(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        createdAt: agents.createdAt,
        description: agents.description,
        id: agents.id,
        slug: agents.slug,
        systemRole: agents.systemRole,
        tags: agents.tags,
        title: agents.title,
        updatedAt: agents.updatedAt,
        userId: agents.userId,
        virtual: agents.virtual,
        visibility: agents.visibility,
        workspaceId: agents.workspaceId,
      })
      .from(agents)
      .where(
        selection.ids
          ? inArray(agents.id, selection.ids)
          : selection.afterId
            ? gt(agents.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(agents.id))
      .limit(selection.limit);

    return rows.map((row) =>
      this.createDocument('agents', {
        created_at: toDateTime(row.createdAt),
        description: row.description,
        id: row.id,
        slug: row.slug,
        system_role: row.systemRole,
        tags: normalizeStringArray(row.tags),
        title: row.title,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        virtual: row.virtual,
        visibility: row.visibility,
        workspace_id: row.workspaceId,
      }),
    );
  }

  private async buildTopics(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        agentId: topics.agentId,
        content: topics.content,
        createdAt: topics.createdAt,
        description: topics.description,
        groupId: topics.groupId,
        id: topics.id,
        sessionId: topics.sessionId,
        status: topics.status,
        title: topics.title,
        updatedAt: topics.updatedAt,
        userId: topics.userId,
        workspaceId: topics.workspaceId,
      })
      .from(topics)
      .where(
        selection.ids
          ? inArray(topics.id, selection.ids)
          : selection.afterId
            ? gt(topics.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(topics.id))
      .limit(selection.limit);

    return rows.map((row) =>
      this.createDocument('topics', {
        agent_id: row.agentId,
        content: row.content,
        created_at: toDateTime(row.createdAt),
        description: row.description,
        group_id: row.groupId,
        id: row.id,
        session_id: row.sessionId,
        status: row.status,
        title: row.title,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        workspace_id: row.workspaceId,
      }),
    );
  }

  private async buildFiles(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        createdAt: files.createdAt,
        fileType: files.fileType,
        id: files.id,
        name: files.name,
        size: files.size,
        source: files.source,
        updatedAt: files.updatedAt,
        userId: files.userId,
        visibility: files.visibility,
        workspaceId: files.workspaceId,
      })
      .from(files)
      .where(
        selection.ids
          ? inArray(files.id, selection.ids)
          : selection.afterId
            ? gt(files.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(files.id))
      .limit(selection.limit);

    const fileIds = rows.map(({ id }) => id);
    const relations =
      fileIds.length === 0
        ? []
        : await this.db
            .select({
              fileId: knowledgeBaseFiles.fileId,
              knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId,
            })
            .from(knowledgeBaseFiles)
            .where(inArray(knowledgeBaseFiles.fileId, fileIds));
    const knowledgeBaseIds = groupKnowledgeBaseIds(relations);

    return rows.map((row) =>
      this.createDocument('files', {
        created_at: toDateTime(row.createdAt),
        file_type: row.fileType,
        id: row.id,
        knowledge_base_ids: knowledgeBaseIds.get(row.id) ?? [],
        name: row.name,
        size: row.size,
        source: row.source,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        visibility: row.visibility,
        workspace_id: row.workspaceId,
      }),
    );
  }

  private async buildKnowledgeBases(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        createdAt: knowledgeBases.createdAt,
        description: knowledgeBases.description,
        id: knowledgeBases.id,
        isPublic: knowledgeBases.isPublic,
        name: knowledgeBases.name,
        type: knowledgeBases.type,
        updatedAt: knowledgeBases.updatedAt,
        userId: knowledgeBases.userId,
        visibility: knowledgeBases.visibility,
        workspaceId: knowledgeBases.workspaceId,
      })
      .from(knowledgeBases)
      .where(
        selection.ids
          ? inArray(knowledgeBases.id, selection.ids)
          : selection.afterId
            ? gt(knowledgeBases.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(knowledgeBases.id))
      .limit(selection.limit);

    return rows.map((row) =>
      this.createDocument('knowledgeBases', {
        created_at: toDateTime(row.createdAt),
        description: row.description,
        id: row.id,
        is_public: row.isPublic,
        name: row.name,
        type: row.type,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        visibility: row.visibility,
        workspace_id: row.workspaceId,
      }),
    );
  }

  private async buildUserMemories(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        capturedAt: userMemories.capturedAt,
        createdAt: userMemories.createdAt,
        details: userMemories.details,
        id: userMemories.id,
        memoryCategory: userMemories.memoryCategory,
        memoryLayer: userMemories.memoryLayer,
        status: userMemories.status,
        summary: userMemories.summary,
        tags: userMemories.tags,
        title: userMemories.title,
        updatedAt: userMemories.updatedAt,
        userId: userMemories.userId,
      })
      .from(userMemories)
      .where(
        selection.ids
          ? inArray(userMemories.id, selection.ids)
          : selection.afterId
            ? gt(userMemories.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(userMemories.id))
      .limit(selection.limit);

    return rows.map((row) =>
      this.createDocument('userMemories', {
        captured_at: toDateTime(row.capturedAt),
        created_at: toDateTime(row.createdAt),
        details: row.details,
        id: row.id,
        memory_category: row.memoryCategory,
        memory_layer: row.memoryLayer,
        status: row.status,
        summary: row.summary,
        tags: normalizeStringArray(row.tags),
        title: row.title,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
      }),
    );
  }

  private async buildChatGroups(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        content: chatGroups.content,
        createdAt: chatGroups.createdAt,
        description: chatGroups.description,
        groupId: chatGroups.groupId,
        id: chatGroups.id,
        title: chatGroups.title,
        updatedAt: chatGroups.updatedAt,
        userId: chatGroups.userId,
        visibility: chatGroups.visibility,
        workspaceId: chatGroups.workspaceId,
      })
      .from(chatGroups)
      .where(
        selection.ids
          ? inArray(chatGroups.id, selection.ids)
          : selection.afterId
            ? gt(chatGroups.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(chatGroups.id))
      .limit(selection.limit);

    return rows.map((row) =>
      this.createDocument('chatGroups', {
        content: row.content,
        created_at: toDateTime(row.createdAt),
        description: row.description,
        group_id: row.groupId,
        id: row.id,
        title: row.title,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        visibility: row.visibility,
        workspace_id: row.workspaceId,
      }),
    );
  }

  private async buildMemoryContexts(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        capturedAt: userMemoriesContexts.capturedAt,
        createdAt: userMemoriesContexts.createdAt,
        currentStatus: userMemoriesContexts.currentStatus,
        description: userMemoriesContexts.description,
        id: userMemoriesContexts.id,
        tags: userMemoriesContexts.tags,
        title: userMemoriesContexts.title,
        type: userMemoriesContexts.type,
        updatedAt: userMemoriesContexts.updatedAt,
        userId: userMemoriesContexts.userId,
        userMemoryIds: userMemoriesContexts.userMemoryIds,
      })
      .from(userMemoriesContexts)
      .where(
        selection.ids
          ? inArray(userMemoriesContexts.id, selection.ids)
          : selection.afterId
            ? gt(userMemoriesContexts.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(userMemoriesContexts.id))
      .limit(selection.limit);

    const parentIds = normalizeIds(rows.flatMap(({ userMemoryIds }) => userMemoryIds ?? []));
    const parents =
      parentIds.length === 0
        ? []
        : await this.db
            .select({
              details: userMemories.details,
              id: userMemories.id,
              memoryCategory: userMemories.memoryCategory,
              summary: userMemories.summary,
              tags: userMemories.tags,
              title: userMemories.title,
              userId: userMemories.userId,
            })
            .from(userMemories)
            .where(inArray(userMemories.id, parentIds));
    const parentById = new Map(parents.map((parent) => [parent.id, parent]));

    return rows.map((row) => {
      const userMemoryIds = normalizeIds(row.userMemoryIds ?? []);
      const matchedParents = userMemoryIds.flatMap((id) => {
        const parent = parentById.get(id);
        return parent && parent.userId === row.userId ? [parent] : [];
      });
      const parentText = userMemoryIds.flatMap((id) => {
        const parent = parentById.get(id);
        if (!parent || parent.userId !== row.userId) return [];
        return [
          [parent.title, parent.summary, parent.details]
            .filter((value) => value !== null)
            .join(' '),
        ];
      });

      return this.createDocument('memoryContexts', {
        captured_at: toDateTime(row.capturedAt),
        created_at: toDateTime(row.createdAt),
        current_status: row.currentStatus,
        description: row.description,
        id: row.id,
        parent_memory_categories: normalizeStringArray(
          matchedParents.flatMap(({ memoryCategory }) => (memoryCategory ? [memoryCategory] : [])),
        ),
        parent_tags: normalizeStringArray(matchedParents.flatMap(({ tags }) => tags ?? [])),
        parent_text: parentText,
        tags: normalizeStringArray(row.tags),
        title: row.title,
        type: row.type,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        user_memory_ids: userMemoryIds,
      });
    });
  }

  private async buildMemoryPreferences(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        capturedAt: userMemoriesPreferences.capturedAt,
        conclusionDirectives: userMemoriesPreferences.conclusionDirectives,
        createdAt: userMemoriesPreferences.createdAt,
        id: userMemoriesPreferences.id,
        parentMemoryCategory: userMemories.memoryCategory,
        parentDetails: userMemories.details,
        parentSummary: userMemories.summary,
        parentTags: userMemories.tags,
        parentTitle: userMemories.title,
        suggestions: userMemoriesPreferences.suggestions,
        tags: userMemoriesPreferences.tags,
        type: userMemoriesPreferences.type,
        updatedAt: userMemoriesPreferences.updatedAt,
        userId: userMemoriesPreferences.userId,
        userMemoryId: userMemoriesPreferences.userMemoryId,
      })
      .from(userMemoriesPreferences)
      .leftJoin(
        userMemories,
        and(
          eq(userMemories.id, userMemoriesPreferences.userMemoryId),
          eq(userMemories.userId, userMemoriesPreferences.userId),
        ),
      )
      .where(
        selection.ids
          ? inArray(userMemoriesPreferences.id, selection.ids)
          : selection.afterId
            ? gt(userMemoriesPreferences.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(userMemoriesPreferences.id))
      .limit(selection.limit);

    return rows.map((row) =>
      this.createDocument('memoryPreferences', {
        captured_at: toDateTime(row.capturedAt),
        conclusion_directives: row.conclusionDirectives,
        created_at: toDateTime(row.createdAt),
        id: row.id,
        parent_details: row.parentDetails,
        parent_memory_categories: normalizeStringArray(row.parentMemoryCategory),
        parent_summary: row.parentSummary,
        parent_tags: normalizeStringArray(row.parentTags),
        parent_title: row.parentTitle,
        suggestions: row.suggestions,
        tags: normalizeStringArray(row.tags),
        type: row.type,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        user_memory_id: row.userMemoryId,
      }),
    );
  }

  private async buildMemoryActivities(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        capturedAt: userMemoriesActivities.capturedAt,
        createdAt: userMemoriesActivities.createdAt,
        endsAt: userMemoriesActivities.endsAt,
        feedback: userMemoriesActivities.feedback,
        id: userMemoriesActivities.id,
        narrative: userMemoriesActivities.narrative,
        notes: userMemoriesActivities.notes,
        parentMemoryCategory: userMemories.memoryCategory,
        parentDetails: userMemories.details,
        parentSummary: userMemories.summary,
        parentTags: userMemories.tags,
        parentTitle: userMemories.title,
        startsAt: userMemoriesActivities.startsAt,
        status: userMemoriesActivities.status,
        tags: userMemoriesActivities.tags,
        type: userMemoriesActivities.type,
        updatedAt: userMemoriesActivities.updatedAt,
        userId: userMemoriesActivities.userId,
        userMemoryId: userMemoriesActivities.userMemoryId,
      })
      .from(userMemoriesActivities)
      .leftJoin(
        userMemories,
        and(
          eq(userMemories.id, userMemoriesActivities.userMemoryId),
          eq(userMemories.userId, userMemoriesActivities.userId),
        ),
      )
      .where(
        selection.ids
          ? inArray(userMemoriesActivities.id, selection.ids)
          : selection.afterId
            ? gt(userMemoriesActivities.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(userMemoriesActivities.id))
      .limit(selection.limit);

    return rows.map((row) =>
      this.createDocument('memoryActivities', {
        captured_at: toDateTime(row.capturedAt),
        created_at: toDateTime(row.createdAt),
        ends_at: toNullableDateTime(row.endsAt),
        feedback: row.feedback,
        id: row.id,
        narrative: row.narrative,
        notes: row.notes,
        parent_details: row.parentDetails,
        parent_memory_categories: normalizeStringArray(row.parentMemoryCategory),
        parent_summary: row.parentSummary,
        parent_tags: normalizeStringArray(row.parentTags),
        parent_title: row.parentTitle,
        starts_at: toNullableDateTime(row.startsAt),
        status: row.status,
        tags: normalizeStringArray(row.tags),
        type: row.type,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        user_memory_id: row.userMemoryId,
      }),
    );
  }

  private async buildMemoryIdentities(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        capturedAt: userMemoriesIdentities.capturedAt,
        createdAt: userMemoriesIdentities.createdAt,
        description: userMemoriesIdentities.description,
        episodicDate: userMemoriesIdentities.episodicDate,
        id: userMemoriesIdentities.id,
        parentMemoryCategory: userMemories.memoryCategory,
        parentDetails: userMemories.details,
        parentSummary: userMemories.summary,
        parentTags: userMemories.tags,
        parentTitle: userMemories.title,
        relationship: userMemoriesIdentities.relationship,
        role: userMemoriesIdentities.role,
        tags: userMemoriesIdentities.tags,
        type: userMemoriesIdentities.type,
        updatedAt: userMemoriesIdentities.updatedAt,
        userId: userMemoriesIdentities.userId,
        userMemoryId: userMemoriesIdentities.userMemoryId,
      })
      .from(userMemoriesIdentities)
      .leftJoin(
        userMemories,
        and(
          eq(userMemories.id, userMemoriesIdentities.userMemoryId),
          eq(userMemories.userId, userMemoriesIdentities.userId),
        ),
      )
      .where(
        selection.ids
          ? inArray(userMemoriesIdentities.id, selection.ids)
          : selection.afterId
            ? gt(userMemoriesIdentities.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(userMemoriesIdentities.id))
      .limit(selection.limit);

    return rows.map((row) =>
      this.createDocument('memoryIdentities', {
        captured_at: toDateTime(row.capturedAt),
        created_at: toDateTime(row.createdAt),
        description: row.description,
        episodic_date: toNullableDateTime(row.episodicDate),
        id: row.id,
        parent_details: row.parentDetails,
        parent_memory_categories: normalizeStringArray(row.parentMemoryCategory),
        parent_summary: row.parentSummary,
        parent_tags: normalizeStringArray(row.parentTags),
        parent_title: row.parentTitle,
        relationship: row.relationship,
        role: row.role,
        tags: normalizeStringArray(row.tags),
        type: row.type,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        user_memory_id: row.userMemoryId,
      }),
    );
  }

  private async buildMemoryExperiences(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        action: userMemoriesExperiences.action,
        capturedAt: userMemoriesExperiences.capturedAt,
        createdAt: userMemoriesExperiences.createdAt,
        id: userMemoriesExperiences.id,
        keyLearning: userMemoriesExperiences.keyLearning,
        parentMemoryCategory: userMemories.memoryCategory,
        parentDetails: userMemories.details,
        parentSummary: userMemories.summary,
        parentTags: userMemories.tags,
        parentTitle: userMemories.title,
        possibleOutcome: userMemoriesExperiences.possibleOutcome,
        reasoning: userMemoriesExperiences.reasoning,
        situation: userMemoriesExperiences.situation,
        tags: userMemoriesExperiences.tags,
        type: userMemoriesExperiences.type,
        updatedAt: userMemoriesExperiences.updatedAt,
        userId: userMemoriesExperiences.userId,
        userMemoryId: userMemoriesExperiences.userMemoryId,
      })
      .from(userMemoriesExperiences)
      .leftJoin(
        userMemories,
        and(
          eq(userMemories.id, userMemoriesExperiences.userMemoryId),
          eq(userMemories.userId, userMemoriesExperiences.userId),
        ),
      )
      .where(
        selection.ids
          ? inArray(userMemoriesExperiences.id, selection.ids)
          : selection.afterId
            ? gt(userMemoriesExperiences.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(userMemoriesExperiences.id))
      .limit(selection.limit);

    return rows.map((row) =>
      this.createDocument('memoryExperiences', {
        action: row.action,
        captured_at: toDateTime(row.capturedAt),
        created_at: toDateTime(row.createdAt),
        id: row.id,
        key_learning: row.keyLearning,
        parent_details: row.parentDetails,
        parent_memory_categories: normalizeStringArray(row.parentMemoryCategory),
        parent_summary: row.parentSummary,
        parent_tags: normalizeStringArray(row.parentTags),
        parent_title: row.parentTitle,
        possible_outcome: row.possibleOutcome,
        reasoning: row.reasoning,
        situation: row.situation,
        tags: normalizeStringArray(row.tags),
        type: row.type,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        user_memory_id: row.userMemoryId,
      }),
    );
  }

  private async buildPersonaDocuments(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        capturedAt: userPersonaDocuments.capturedAt,
        createdAt: userPersonaDocuments.createdAt,
        id: userPersonaDocuments.id,
        persona: userPersonaDocuments.persona,
        profile: userPersonaDocuments.profile,
        tagline: userPersonaDocuments.tagline,
        updatedAt: userPersonaDocuments.updatedAt,
        userId: userPersonaDocuments.userId,
        version: userPersonaDocuments.version,
      })
      .from(userPersonaDocuments)
      .where(
        selection.ids
          ? inArray(userPersonaDocuments.id, selection.ids)
          : selection.afterId
            ? gt(userPersonaDocuments.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(userPersonaDocuments.id))
      .limit(selection.limit);

    return rows.map((row) =>
      this.createDocument('personaDocuments', {
        captured_at: toDateTime(row.capturedAt),
        created_at: toDateTime(row.createdAt),
        id: row.id,
        persona: row.persona,
        profile: row.profile,
        tagline: row.tagline,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        version: row.version,
      }),
    );
  }

  private async buildDocuments(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        content: documents.content,
        createdAt: documents.createdAt,
        description: documents.description,
        fileId: documents.fileId,
        fileType: documents.fileType,
        id: documents.id,
        knowledgeBaseId: documents.knowledgeBaseId,
        parentId: documents.parentId,
        slug: documents.slug,
        sourceType: documents.sourceType,
        title: documents.title,
        totalCharCount: documents.totalCharCount,
        updatedAt: documents.updatedAt,
        userId: documents.userId,
        visibility: documents.visibility,
        workspaceId: documents.workspaceId,
      })
      .from(documents)
      .where(
        selection.ids
          ? inArray(documents.id, selection.ids)
          : selection.afterId
            ? gt(documents.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(documents.id))
      .limit(selection.limit);

    const fileIds = normalizeIds(rows.flatMap(({ fileId }) => (fileId ? [fileId] : [])));
    const relations =
      fileIds.length === 0
        ? []
        : await this.db
            .select({
              fileId: knowledgeBaseFiles.fileId,
              knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId,
            })
            .from(knowledgeBaseFiles)
            .where(inArray(knowledgeBaseFiles.fileId, fileIds));
    const knowledgeBaseIdsByFile = groupKnowledgeBaseIds(relations);

    return rows.map((row) => {
      const knowledgeBaseIds = new Set<string>();
      if (row.knowledgeBaseId) knowledgeBaseIds.add(row.knowledgeBaseId);
      if (row.fileId) {
        for (const knowledgeBaseId of knowledgeBaseIdsByFile.get(row.fileId) ?? []) {
          knowledgeBaseIds.add(knowledgeBaseId);
        }
      }

      return this.createDocument('documents', {
        content: row.content,
        created_at: toDateTime(row.createdAt),
        description: row.description,
        file_id: row.fileId,
        file_type: row.fileType,
        id: row.id,
        knowledge_base_id: row.knowledgeBaseId,
        knowledge_base_ids: [...knowledgeBaseIds].sort(),
        parent_id: row.parentId,
        slug: row.slug,
        source_type: row.sourceType,
        title: row.title,
        total_char_count: row.totalCharCount,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        visibility: row.visibility,
        workspace_id: row.workspaceId,
      });
    });
  }

  private async buildMessages(selection: FtsSearchDocumentSelection) {
    const rows = await this.db
      .select({
        agentId: messages.agentId,
        content: messages.content,
        createdAt: messages.createdAt,
        groupId: messages.groupId,
        id: messages.id,
        role: messages.role,
        sessionId: messages.sessionId,
        summary: messages.summary,
        threadId: messages.threadId,
        topicId: messages.topicId,
        updatedAt: messages.updatedAt,
        userId: messages.userId,
        workspaceId: messages.workspaceId,
      })
      .from(messages)
      .where(
        selection.ids
          ? inArray(messages.id, selection.ids)
          : selection.afterId
            ? gt(messages.id, selection.afterId)
            : undefined,
      )
      .orderBy(asc(messages.id))
      .limit(selection.limit);

    return rows.map((row) =>
      this.createDocument('messages', {
        agent_id: row.agentId,
        content: row.content,
        created_at: toDateTime(row.createdAt),
        group_id: row.groupId,
        id: row.id,
        role: row.role,
        session_id: row.sessionId,
        summary: row.summary,
        thread_id: row.threadId,
        topic_id: row.topicId,
        updated_at: toDateTime(row.updatedAt),
        user_id: row.userId,
        workspace_id: row.workspaceId,
      }),
    );
  }
}

export type FtsSearchDocumentFor<Entity extends FtsSearchDocumentEntity> = Extract<
  FtsSearchBuiltDocument,
  { entity: Entity; source: FtsSearchDocumentSourceMap[Entity] }
>;
