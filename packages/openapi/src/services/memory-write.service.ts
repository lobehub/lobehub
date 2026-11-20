import {
  type AsyncTaskStatus,
  ContextStatusEnum,
  TypesEnum,
  type UserMemoryExtractionMetadata,
} from '@lobechat/types';
import type { z } from 'zod';

import { TopicModel } from '@/database/models/topic';
import {
  UserMemoryActivityModel,
  UserMemoryContextModel,
  UserMemoryExperienceModel,
  UserMemoryIdentityModel,
  UserMemoryPreferenceModel,
} from '@/database/models/userMemory';
import type { LobeChatDatabase } from '@/database/type';
import { userMemoriesRouter } from '@/server/routers/lambda/userMemories';
import { userMemoryRouter } from '@/server/routers/lambda/userMemory';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import {
  MemoryActivitySchema,
  MemoryContextSchema,
  MemoryExperienceSchema,
  MemoryIdentitySchema,
  MemoryPreferenceSchema,
} from '../types/memory.type';
import type {
  CreateMemoryActivity,
  CreateMemoryContext,
  CreateMemoryExperience,
  CreateMemoryIdentity,
  CreateMemoryPreference,
  MemoryExtractionTask,
  MemorySearchRequest,
  MemorySearchResult,
  RestoredPersona,
  StartMemoryExtraction,
  UpdateMemoryActivity,
  UpdateMemoryContext,
  UpdateMemoryExperience,
  UpdateMemoryIdentity,
  UpdateMemoryPreference,
} from '../types/memory-write.type';
import { MemorySearchResultSchema } from '../types/memory-write.type';

const DEFAULT_CATEGORY = 'general';

type Shape = z.ZodObject;

/**
 * Keep only the keys a response schema declares: rows carry embedding vectors
 * (and search hits extra ranking columns) that are never part of the API.
 */
const project = <T>(schema: Shape, row: object): T => {
  const keys = Object.keys(schema.shape);
  const source = row as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, source[key] ?? null])) as T;
};

type MemoryEntryOf<S extends Shape> = z.infer<S>;

const searchItem = MemorySearchResultSchema.shape;

/**
 * Memory write / retrieval REST service.
 *
 * Every operation goes through the `userMemory` / `userMemories` tRPC
 * procedures the memory UI and the memory agent tools use, invoked server-side
 * with no API-key scopes in their context (the REST route has already narrowed
 * the key to `user:*`). That keeps embedding on write, the persona's
 * personal-scope rule, extraction de-duplication and workflow scheduling in
 * one implementation. This layer maps REST bodies onto those inputs, turns
 * "not the caller's" into 404 and reads the written row back so the response
 * is the entry itself.
 */
export class MemoryWriteRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };
  private readonly activityModel: UserMemoryActivityModel;
  private readonly contextModel: UserMemoryContextModel;
  private readonly experienceModel: UserMemoryExperienceModel;
  private readonly identityModel: UserMemoryIdentityModel;
  private readonly preferenceModel: UserMemoryPreferenceModel;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
    this.activityModel = new UserMemoryActivityModel(db, this.userId);
    this.contextModel = new UserMemoryContextModel(db, this.userId);
    this.experienceModel = new UserMemoryExperienceModel(db, this.userId);
    this.identityModel = new UserMemoryIdentityModel(db, this.userId);
    this.preferenceModel = new UserMemoryPreferenceModel(db, this.userId);
  }

  private get memory() {
    return userMemoryRouter.createCaller(this.ctx);
  }

  private get memories() {
    return userMemoriesRouter.createCaller(this.ctx);
  }

  /**
   * The shared write procedures catch every failure and report it as
   * `{ success: false, message }`; that message is raw database / embedding
   * text, so it is logged rather than returned.
   */
  private assertSaved(result: { message: string; success: boolean }) {
    if (result.success) return;
    this.log('error', 'Memory write failed', { message: result.message });
    throw new ApiException(500, 'internal_error', 'Failed to save the memory entry');
  }

  private async readBack<S extends Shape>(
    schema: S,
    find: (id: string) => Promise<object | undefined>,
    id: string | undefined,
  ): Promise<MemoryEntryOf<S>> {
    const row = id ? await find(id) : undefined;
    if (!row) throw this.createNotFoundError('Memory entry not found');
    return project<MemoryEntryOf<S>>(schema, row);
  }

  // ==================== Create ====================

  async createIdentity(body: CreateMemoryIdentity) {
    const tags = body.tags ?? [];
    const result = await this.memories.toolAddIdentityMemory({
      details: body.details ?? null,
      memoryCategory: body.category ?? DEFAULT_CATEGORY,
      memoryType: body.memoryType ?? TypesEnum.People,
      summary: body.summary,
      tags,
      title: body.title,
      withIdentity: {
        description: body.description,
        episodicDate: body.episodicDate ?? null,
        extractedLabels: tags,
        relationship: body.relationship ?? 'self',
        role: body.role ?? null,
        scoreConfidence: 1,
        sourceEvidence: null,
        sourceIds: [],
        type: body.type ?? 'personal',
      },
    });
    this.assertSaved(result);
    return this.readBack(MemoryIdentitySchema, this.identityModel.findById, result.identityId);
  }

  async createPreference(body: CreateMemoryPreference) {
    const tags = body.tags ?? [];
    const result = await this.memories.toolAddPreferenceMemory({
      details: body.details ?? '',
      memoryCategory: body.category ?? DEFAULT_CATEGORY,
      memoryType: body.memoryType ?? TypesEnum.Preference,
      summary: body.summary,
      tags,
      title: body.title,
      withPreference: {
        appContext: null,
        conclusionDirectives: body.conclusionDirectives,
        extractedLabels: tags,
        extractedScopes: [],
        originContext: null,
        scorePriority: body.scorePriority ?? 0.5,
        suggestions: body.suggestions ?? [],
        type: body.memoryType ?? TypesEnum.Preference,
      },
    });
    this.assertSaved(result);
    return this.readBack(
      MemoryPreferenceSchema,
      this.preferenceModel.findById,
      result.preferenceId,
    );
  }

  async createContext(body: CreateMemoryContext) {
    const tags = body.tags ?? [];
    const result = await this.memories.toolAddContextMemory({
      details: body.details ?? '',
      memoryCategory: body.category ?? DEFAULT_CATEGORY,
      memoryType: body.memoryType ?? TypesEnum.Context,
      summary: body.summary,
      tags,
      title: body.title,
      withContext: {
        associatedObjects: [],
        associatedSubjects: [],
        currentStatus: body.currentStatus ?? ContextStatusEnum.Ongoing,
        description: body.description,
        labels: tags,
        scoreImpact: body.scoreImpact ?? 0.5,
        scoreUrgency: body.scoreUrgency ?? 0.5,
        title: body.title,
        type: body.type ?? 'project',
      },
    });
    this.assertSaved(result);
    return this.readBack(MemoryContextSchema, this.contextModel.findById, result.contextId);
  }

  async createActivity(body: CreateMemoryActivity) {
    const result = await this.memories.toolAddActivityMemory({
      details: body.details ?? '',
      memoryCategory: body.category ?? DEFAULT_CATEGORY,
      memoryType: TypesEnum.Activity,
      summary: body.summary,
      tags: body.tags ?? [],
      title: body.title,
      withActivity: {
        endsAt: body.endsAt ?? null,
        feedback: body.feedback ?? null,
        narrative: body.narrative,
        notes: body.notes ?? null,
        startsAt: body.startsAt ?? null,
        status: body.status ?? null,
        tags: body.tags ?? null,
        timezone: body.timezone ?? null,
        type: body.type,
      },
    });
    this.assertSaved(result);
    return this.readBack(MemoryActivitySchema, this.activityModel.findById, result.activityId);
  }

  async createExperience(body: CreateMemoryExperience) {
    const tags = body.tags ?? [];
    const result = await this.memories.toolAddExperienceMemory({
      details: body.details ?? '',
      memoryCategory: body.category ?? DEFAULT_CATEGORY,
      memoryType: body.memoryType ?? TypesEnum.Fact,
      summary: body.summary,
      tags,
      title: body.title,
      withExperience: {
        action: body.action ?? '',
        keyLearning: body.keyLearning ?? '',
        knowledgeValueScore: 0.5,
        labels: tags,
        possibleOutcome: body.possibleOutcome ?? '',
        problemSolvingScore: 0.5,
        reasoning: body.reasoning ?? '',
        scoreConfidence: body.scoreConfidence ?? 0.5,
        situation: body.situation,
        type: body.memoryType ?? TypesEnum.Fact,
      },
    });
    this.assertSaved(result);
    return this.readBack(
      MemoryExperienceSchema,
      this.experienceModel.findById,
      result.experienceId,
    );
  }

  // ==================== Update ====================

  /** 404 before writing: the shared update procedures report a miss silently. */
  private async requireEntry(find: (id: string) => Promise<object | undefined>, id: string) {
    if (!(await find(id))) throw this.createNotFoundError('Memory entry not found');
  }

  async updateIdentity(id: string, body: UpdateMemoryIdentity) {
    await this.requireEntry(this.identityModel.findById, id);
    const { tags, ...rest } = body;
    await this.memory.updateIdentity({ data: { ...rest, extractedLabels: tags }, id });
    return this.readBack(MemoryIdentitySchema, this.identityModel.findById, id);
  }

  async updatePreference(id: string, body: UpdateMemoryPreference) {
    await this.requireEntry(this.preferenceModel.findById, id);
    await this.memory.updatePreference({ data: body, id });
    return this.readBack(MemoryPreferenceSchema, this.preferenceModel.findById, id);
  }

  async updateContext(id: string, body: UpdateMemoryContext) {
    await this.requireEntry(this.contextModel.findById, id);
    await this.memory.updateContext({ data: body, id });
    return this.readBack(MemoryContextSchema, this.contextModel.findById, id);
  }

  async updateActivity(id: string, body: UpdateMemoryActivity) {
    await this.requireEntry(this.activityModel.findById, id);
    await this.memory.updateActivity({ data: body, id });
    return this.readBack(MemoryActivitySchema, this.activityModel.findById, id);
  }

  async updateExperience(id: string, body: UpdateMemoryExperience) {
    await this.requireEntry(this.experienceModel.findById, id);
    await this.memory.updateExperience({ data: body, id });
    return this.readBack(MemoryExperienceSchema, this.experienceModel.findById, id);
  }

  // ==================== Search ====================

  /** `userMemories.searchMemory`, or `retrieveMemoryForTopic` when a topic is named. */
  async search(body: MemorySearchRequest): Promise<MemorySearchResult> {
    const { topicId, ...params } = body;
    let result;
    if (topicId) {
      const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findById(topicId);
      if (!topic) throw this.createNotFoundError('Topic not found');
      result = await this.memories.retrieveMemoryForTopic({ topicId });
    } else {
      result = await this.memories.searchMemory(params);
    }

    const items = <S extends Shape>(schema: S, rows: object[] | undefined) =>
      (rows ?? []).map((row) => project<z.infer<S>>(schema, row));

    return {
      activities: items(searchItem.activities.element, result.activities),
      contexts: items(searchItem.contexts.element, result.contexts),
      experiences: items(searchItem.experiences.element, result.experiences),
      identities: items(searchItem.identities.element, result.identities),
      meta: result.meta
        ? { appliedQueries: result.meta.appliedQueries, layers: result.meta.layers }
        : null,
      preferences: items(searchItem.preferences.element, result.preferences),
    };
  }

  // ==================== Extraction ====================

  private toTask(
    task: {
      error?: unknown;
      id: string;
      metadata?: UserMemoryExtractionMetadata | null;
      status: AsyncTaskStatus;
    },
    deduped: boolean,
  ): MemoryExtractionTask {
    const error = task.error as { body?: unknown; name?: string } | null | undefined;
    const body = error?.body as { detail?: string } | string | undefined;
    return {
      deduped,
      error: error
        ? {
            message: (typeof body === 'string' ? body : body?.detail) ?? '',
            name: error.name ?? 'Error',
          }
        : null,
      id: task.id,
      progress: {
        completedTopics: task.metadata?.progress?.completedTopics ?? 0,
        totalTopics: task.metadata?.progress?.totalTopics ?? null,
      },
      range: { from: task.metadata?.range?.from ?? null, to: task.metadata?.range?.to ?? null },
      status: task.status,
    };
  }

  /** Queue extraction from the caller's chat topics (`requestMemoryFromChatTopic`). */
  async startExtraction(body: StartMemoryExtraction): Promise<MemoryExtractionTask> {
    const task = await this.memory.requestMemoryFromChatTopic({
      fromDate: body.fromDate ? new Date(body.fromDate) : undefined,
      toDate: body.toDate ? new Date(body.toDate) : undefined,
    });
    return this.toTask(task, task.deduped);
  }

  async getExtraction(taskId: string): Promise<MemoryExtractionTask> {
    const task = await this.memory.getMemoryExtractionTask({ taskId });
    if (!task) throw this.createNotFoundError('Memory extraction task not found');
    return this.toTask(task, false);
  }

  // ==================== Persona ====================

  async restorePersonaVersion(historyId: string): Promise<RestoredPersona> {
    const { personaVersion } = await this.memory.restorePersonaVersion({ historyId });
    const persona = await this.memory.getPersona();
    return {
      historyId,
      persona: persona ?? { content: '', summary: '' },
      version: personaVersion,
    };
  }
}
