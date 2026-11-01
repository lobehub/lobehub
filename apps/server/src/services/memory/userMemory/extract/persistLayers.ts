import type {
  MemoryExtractionJob,
  MemoryExtractionResult,
  WithActivity,
} from '@lobechat/memory-user-memory';
import { ActivityMemoryItemSchema } from '@lobechat/memory-user-memory';
import type { ModelRuntime } from '@lobechat/model-runtime';

import { UserMemoryModel } from '@/database/models/userMemory';
import type { getServerDB } from '@/database/server';
import type { MergeStrategyEnum } from '@/types/userMemory';
import { LayersEnum, TypesEnum } from '@/types/userMemory';

import { LAYER_LABEL_MAP } from './constants';
import type { MemoryExtractionExecutorContext } from './context';
import type { MemoryExtractionTaskErrorItem } from './errors';
import { makeTaskErrorItem } from './errors';
import type { PersistLayerResult } from './types';

const normalizeActivityAssociationList = (value: unknown) => {
  if (value === null || value === undefined || value === '') return value;
  const list = Array.isArray(value) ? value : typeof value === 'object' ? [value] : value;
  if (!Array.isArray(list)) return list;

  return list.map((item) => {
    if (!item || typeof item !== 'object' || !('extra' in item)) return item;

    const extra = (item as Record<string, unknown>).extra;
    if (extra === null || extra === undefined || typeof extra === 'string') return item;

    return {
      ...item,
      extra: typeof extra === 'object' ? JSON.stringify(extra) : String(extra),
    };
  });
};

const normalizeActivityMemoryCandidate = (item: unknown) => {
  if (!item || typeof item !== 'object' || !('withActivity' in item)) return item;
  const withActivity = item.withActivity as WithActivity | undefined;
  if (!withActivity || typeof withActivity !== 'object') return item;

  return {
    ...item,
    withActivity: {
      ...withActivity,
      associatedLocations: normalizeActivityAssociationList(withActivity.associatedLocations),
      associatedObjects: normalizeActivityAssociationList(withActivity.associatedObjects),
      associatedSubjects: normalizeActivityAssociationList(withActivity.associatedSubjects),
    },
  };
};

export function buildBaseMetadata(
  job: MemoryExtractionJob,
  messageIds: string[],
  layer: LayersEnum,
  labels?: string[] | null,
) {
  return {
    labels: labels ?? undefined,
    layer,
    messageIds,
    source: job.source,
    sourceId: job.sourceId,
  };
}

export async function persistActivityMemories(
  ctx: MemoryExtractionExecutorContext,
  job: MemoryExtractionJob,
  messageIds: string[],
  result: NonNullable<MemoryExtractionResult['outputs']['activity']>['data'],
  runtime: ModelRuntime,
  model: string,
  tokenLimit: number | undefined,
  db: Awaited<ReturnType<typeof getServerDB>>,
) {
  const insertedIds: string[] = [];
  const errors: MemoryExtractionTaskErrorItem[] = [];
  const userMemoryModel = new UserMemoryModel(db, job.userId);

  for (const [index, rawItem] of (result?.memories ?? []).entries()) {
    const normalizedItem = normalizeActivityMemoryCandidate(rawItem);

    try {
      const parsedItem = ActivityMemoryItemSchema.safeParse(normalizedItem);

      if (!parsedItem.success) {
        errors.push(
          makeTaskErrorItem('persist', new Error(parsedItem.error.message), {
            layer: LAYER_LABEL_MAP[LayersEnum.Activity],
            memoryIndex: index,
            preview: normalizedItem,
            sourceId: job.sourceId,
            sourceType: job.source,
          }),
        );
        continue;
      }

      const item = parsedItem.data;
      const activityTags = item.withActivity?.tags ?? item.tags;
      const associatedObjects = UserMemoryModel.parseAssociatedObjects(
        item.withActivity?.associatedObjects,
      );
      const associatedSubjects = UserMemoryModel.parseAssociatedSubjects(
        item.withActivity?.associatedSubjects,
      );
      const associatedLocations = UserMemoryModel.parseAssociatedLocations(
        item.withActivity?.associatedLocations,
      );
      const [summaryVector, detailsVector, narrativeVector, feedbackVector] =
        await ctx.generateEmbeddings(
          runtime,
          model,
          [item.summary, item.details, item.withActivity?.narrative, item.withActivity?.feedback],
          job.userId,
          tokenLimit,
        );
      const baseMetadata = ctx.buildBaseMetadata(
        job,
        messageIds,
        LayersEnum.Activity,
        activityTags,
      );

      const { memory } = await userMemoryModel.createActivityMemory({
        activity: {
          associatedLocations: associatedLocations.length > 0 ? associatedLocations : [],
          associatedObjects: associatedObjects.length > 0 ? associatedObjects : [],
          associatedSubjects: associatedSubjects.length > 0 ? associatedSubjects : [],
          capturedAt: job.sourceUpdatedAt,
          endsAt: UserMemoryModel.parseDateFromString(item.withActivity?.endsAt),
          feedback: item.withActivity?.feedback ?? null,
          feedbackVector: feedbackVector ?? null,
          metadata: baseMetadata,
          narrative: item.withActivity?.narrative ?? null,
          narrativeVector: narrativeVector ?? null,
          notes: item.withActivity?.notes ?? null,
          startsAt: UserMemoryModel.parseDateFromString(item.withActivity?.startsAt),
          status: item.withActivity?.status ?? 'pending',
          tags: activityTags ?? null,
          timezone: item.withActivity?.timezone ?? null,
          type: item.withActivity?.type ?? 'other',
        },
        capturedAt: job.sourceUpdatedAt,
        details: item.details ?? '',
        detailsEmbedding: detailsVector ?? undefined,
        memoryCategory: item.memoryCategory ?? null,
        memoryLayer: LayersEnum.Activity,
        memoryType: (item.memoryType as TypesEnum) ?? TypesEnum.Activity,
        summary: item.summary ?? '',
        summaryEmbedding: summaryVector ?? undefined,
        title: item.title ?? '',
      });

      insertedIds.push(memory.id);
    } catch (error) {
      errors.push(
        makeTaskErrorItem('persist', error, {
          layer: LAYER_LABEL_MAP[LayersEnum.Activity],
          memoryIndex: index,
          preview: normalizedItem,
          sourceId: job.sourceId,
          sourceType: job.source,
        }),
      );
    }
  }

  return { errors, ids: insertedIds } satisfies PersistLayerResult;
}

export async function persistContextMemories(
  ctx: MemoryExtractionExecutorContext,
  job: MemoryExtractionJob,
  messageIds: string[],
  result: NonNullable<MemoryExtractionResult['outputs']['context']>['data'],
  runtime: ModelRuntime,
  model: string,
  tokenLimit: number | undefined,
  db: Awaited<ReturnType<typeof getServerDB>>,
) {
  const insertedIds: string[] = [];
  const userMemoryModel = new UserMemoryModel(db, job.userId);

  for (const item of result?.memories ?? []) {
    const [summaryVector, detailsVector, descriptionVector] = await ctx.generateEmbeddings(
      runtime,
      model,
      [item.summary, item.details, item.withContext?.description],
      job.userId,
      tokenLimit,
    );
    const baseMetadata = ctx.buildBaseMetadata(
      job,
      messageIds,
      LayersEnum.Context,
      item.withContext?.labels,
    );

    const { memory } = await userMemoryModel.createContextMemory({
      capturedAt: job.sourceUpdatedAt,
      context: {
        associatedObjects: UserMemoryModel.parseAssociatedObjects(
          item.withContext?.associatedObjects,
        ),
        associatedSubjects: UserMemoryModel.parseAssociatedSubjects(
          item.withContext?.associatedSubjects,
        ),
        capturedAt: job.sourceUpdatedAt,
        currentStatus: item.withContext?.currentStatus ?? null,
        description: item.withContext?.description ?? null,
        descriptionVector: descriptionVector || null,
        metadata: baseMetadata,
        scoreImpact: item.withContext?.scoreImpact ?? null,
        scoreUrgency: item.withContext?.scoreUrgency ?? null,
        tags: item.withContext?.labels ?? null,
        title: item.withContext?.title ?? null,
        type: item.withContext?.type ?? null,
      },
      details: item.details ?? '',
      detailsEmbedding: detailsVector ?? undefined,
      memoryCategory: item.memoryCategory ?? null,
      memoryLayer: LayersEnum.Context,
      memoryType: (item.memoryType as TypesEnum) ?? TypesEnum.Context,
      summary: item.summary ?? '',
      summaryEmbedding: summaryVector ?? undefined,
      title: item.title ?? '',
    });

    insertedIds.push(memory.id);
  }

  return { errors: [], ids: insertedIds } satisfies PersistLayerResult;
}

export async function persistExperienceMemories(
  ctx: MemoryExtractionExecutorContext,
  job: MemoryExtractionJob,
  messageIds: string[],
  result: NonNullable<MemoryExtractionResult['outputs']['experience']>['data'],
  runtime: ModelRuntime,
  model: string,
  tokenLimit: number | undefined,
  db: Awaited<ReturnType<typeof getServerDB>>,
) {
  const insertedIds: string[] = [];
  const userMemoryModel = new UserMemoryModel(db, job.userId);

  for (const item of result?.memories ?? []) {
    const [summaryVector, detailsVector, situationVector, actionVector, keyLearningVector] =
      await ctx.generateEmbeddings(
        runtime,
        model,
        [
          item.summary,
          item.details,
          item.withExperience?.situation,
          item.withExperience?.action,
          item.withExperience?.keyLearning,
        ],
        job.userId,
        tokenLimit,
      );
    const baseMetadata = ctx.buildBaseMetadata(
      job,
      messageIds,
      LayersEnum.Experience,
      item.withExperience?.labels,
    );

    const { memory } = await userMemoryModel.createExperienceMemory({
      capturedAt: job.sourceUpdatedAt,
      details: item.details ?? '',
      detailsEmbedding: detailsVector ?? undefined,
      experience: {
        action: item.withExperience?.action ?? null,
        actionVector: actionVector || null,
        capturedAt: job.sourceUpdatedAt,
        keyLearning: item.withExperience?.keyLearning ?? null,
        keyLearningVector: keyLearningVector || null,
        metadata: baseMetadata,
        possibleOutcome: item.withExperience?.possibleOutcome ?? null,
        reasoning: item.withExperience?.reasoning ?? null,
        scoreConfidence: item.withExperience?.scoreConfidence ?? null,
        situation: item.withExperience?.situation ?? null,
        situationVector: situationVector || null,
        tags: item.withExperience?.labels ?? null,
        type: item.withExperience?.type ?? null,
      },
      memoryCategory: item.memoryCategory ?? null,
      memoryLayer: LayersEnum.Experience,
      memoryType: (item.memoryType as TypesEnum) ?? TypesEnum.Activity,
      summary: item.summary ?? '',
      summaryEmbedding: summaryVector ?? undefined,
      title: item.title ?? '',
    });

    insertedIds.push(memory.id);
  }

  return { errors: [], ids: insertedIds } satisfies PersistLayerResult;
}

export async function persistPreferenceMemories(
  ctx: MemoryExtractionExecutorContext,
  job: MemoryExtractionJob,
  messageIds: string[],
  result: NonNullable<MemoryExtractionResult['outputs']['preference']>['data'],
  runtime: ModelRuntime,
  model: string,
  tokenLimit: number | undefined,
  db: Awaited<ReturnType<typeof getServerDB>>,
) {
  const insertedIds: string[] = [];
  const userMemoryModel = new UserMemoryModel(db, job.userId);

  for (const item of result?.memories ?? []) {
    const [summaryVector, detailsVector, directiveVector] = await ctx.generateEmbeddings(
      runtime,
      model,
      [item.summary, item.details, item.withPreference?.conclusionDirectives],
      job.userId,
      tokenLimit,
    );
    const baseMetadata = ctx.buildBaseMetadata(
      job,
      messageIds,
      LayersEnum.Preference,
      item.withPreference?.extractedLabels,
    );

    const { memory } = await userMemoryModel.createPreferenceMemory({
      capturedAt: job.sourceUpdatedAt,
      details: item.details ?? '',
      detailsEmbedding: detailsVector ?? undefined,
      memoryCategory: item.memoryCategory ?? null,
      memoryLayer: LayersEnum.Preference,
      memoryType: (item.memoryType as TypesEnum) ?? TypesEnum.Preference,
      preference: {
        capturedAt: job.sourceUpdatedAt,
        conclusionDirectives: item.withPreference?.conclusionDirectives ?? null,
        conclusionDirectivesVector: directiveVector ?? null,
        metadata: {
          ...baseMetadata,
          scopes: item.withPreference?.extractedScopes ?? undefined,
        },
        scorePriority: item.withPreference?.scorePriority ?? null,
        suggestions: item.withPreference?.suggestions?.join('\n') ?? null,
        tags: item.withPreference?.extractedLabels ?? null,
        type: item.withPreference?.type ?? null,
      },
      summary: item.summary ?? '',
      summaryEmbedding: summaryVector ?? undefined,
      title: item.title ?? '',
    });

    insertedIds.push(memory.id);
  }

  return { errors: [], ids: insertedIds } satisfies PersistLayerResult;
}

export async function persistIdentityMemories(
  ctx: MemoryExtractionExecutorContext,
  job: MemoryExtractionJob,
  messageIds: string[],
  result: NonNullable<MemoryExtractionResult['outputs']['identity']>['data'],
  runtime: ModelRuntime,
  model: string,
  tokenLimit: number | undefined,
  db: Awaited<ReturnType<typeof getServerDB>>,
) {
  const insertedIds: string[] = [];
  const userMemoryModel = new UserMemoryModel(db, job.userId);

  const addActions = result?.add ?? [];
  const updateActions = result?.update ?? [];
  const removeActions = result?.remove ?? [];

  for (const action of addActions) {
    const [summaryVector, detailsVector, descriptionVector] = await ctx.generateEmbeddings(
      runtime,
      model,
      [action.summary, action.details, action.withIdentity.description],
      job.userId,
      tokenLimit,
    );
    const metadata = ctx.buildBaseMetadata(
      job,
      messageIds,
      LayersEnum.Identity,
      action.withIdentity?.extractedLabels,
    );

    const res = await userMemoryModel.addIdentityEntry({
      base: {
        capturedAt: job.sourceUpdatedAt,
        details: action.details,
        detailsVector1024: detailsVector ?? undefined,
        memoryCategory: 'people',
        memoryLayer: LayersEnum.Identity,
        memoryType: TypesEnum.People,
        metadata,
        summary: action.summary,
        summaryVector1024: summaryVector ?? undefined,
        title: action.title,
      },
      identity: {
        capturedAt: job.sourceUpdatedAt,
        description: action.withIdentity.description,
        descriptionVector: descriptionVector ?? undefined,
        metadata,
        relationship: action.withIdentity.relationship ?? undefined,
        role: action.withIdentity.role ?? undefined,
        tags: action.withIdentity.extractedLabels ?? undefined,
        type: action.withIdentity.type ?? undefined,
      },
    });

    insertedIds.push(res.userMemoryId);
  }

  for (const action of updateActions) {
    const { set } = action;

    const [summaryVector, detailsVector, descriptionVector] = set.withIdentity?.description
      ? await ctx.generateEmbeddings(
          runtime,
          model,
          [set.summary, set.details, set.withIdentity.description],
          job.userId,
          tokenLimit,
        )
      : [];

    await userMemoryModel.updateIdentityEntry({
      base: {
        capturedAt: job.sourceUpdatedAt,
        details: set.details,
        detailsVector1024: detailsVector ?? undefined,
        memoryCategory: set.memoryCategory,
        memoryType: set.memoryType,
        summary: set.summary,
        summaryVector1024: summaryVector ?? undefined,
        tags: set.tags,
        title: set.title,
      },
      identity: {
        capturedAt: job.sourceUpdatedAt,
        description: set.withIdentity?.description,
        descriptionVector: descriptionVector ?? undefined,
        metadata: set.withIdentity.extractedLabels
          ? ctx.buildBaseMetadata(
              job,
              messageIds,
              LayersEnum.Identity,
              set.withIdentity.extractedLabels,
            )
          : undefined,
        relationship: set.withIdentity.relationship ?? undefined,
        role: set.withIdentity.role ?? undefined,
        type: set.withIdentity.type ?? undefined,
      },
      identityId: action.id,
      mergeStrategy: action.mergeStrategy as MergeStrategyEnum,
    });
  }

  for (const action of removeActions) {
    await userMemoryModel.removeIdentityEntry(action.id);
  }

  return { errors: [], ids: insertedIds } satisfies PersistLayerResult;
}
