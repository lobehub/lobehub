import type { AsyncTaskError, ImageGenerationAsset, VideoGenerationAsset } from '@lobechat/types';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import type { GenerationKind, GenerationWithBatch } from '@/database/models/generation';
import { GenerationModel } from '@/database/models/generation';
import { GenerationTopicModel } from '@/database/models/generationTopic';
import type { LobeChatDatabase } from '@/database/type';
import { generationRouter } from '@/server/routers/lambda/generation';
import { generationTopicRouter } from '@/server/routers/lambda/generationTopic';
import { imageRouter } from '@/server/routers/lambda/image';
import { videoRouter } from '@/server/routers/lambda/video';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import { resolvePagination } from '../helpers/pagination';
import type { DeletedResource } from '../types/common.type';
import type {
  CreateImageGenerationRequest,
  CreateVideoGenerationRequest,
  GenerationAssetPayload,
  GenerationBatchCreated,
  GenerationListQuery,
  GenerationPayload,
} from '../types/generation.type';
import { GENERATION_KINDS, TERMINAL_GENERATION_STATUSES } from '../types/generation.type';

const WAIT_POLL_INTERVAL_MS = 1000;

const isTerminal = (status: string) =>
  (TERMINAL_GENERATION_STATUSES as readonly string[]).includes(status);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const withoutUndefined = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const toErrorPayload = (error: AsyncTaskError | null | undefined) => {
  if (!error) return null;
  const body = error.body as unknown;
  const message =
    typeof body === 'string'
      ? body
      : body && typeof body === 'object' && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : error.name;
  return { message, name: error.name };
};

const toAssetPayload = (
  asset: ImageGenerationAsset | VideoGenerationAsset | null | undefined,
): GenerationAssetPayload | null => {
  if (!asset) return null;
  const video = asset as VideoGenerationAsset;
  return {
    coverUrl: video.coverUrl ?? null,
    duration: video.duration ?? null,
    height: asset.height ?? null,
    thumbnailUrl: asset.thumbnailUrl ?? null,
    url: asset.url ?? null,
    width: asset.width ?? null,
  };
};

/**
 * Image / video generation REST service.
 *
 * Starting a generation goes through the same `image.createImage` /
 * `video.createVideo` procedures the Image and Video pages and `lh generate`
 * call — invoked server-side without API-key scopes in their context (the REST
 * route has already narrowed the key to `generation:*`). That keeps one
 * implementation of model resolution, parameter checks, storage admission,
 * pre-charge and settlement. Reads use the generation model's ownership filter
 * (creator in personal mode, workspace visibility in a workspace); deletes go
 * through `generation.deleteGeneration`, which also enforces that only the
 * creator or a workspace owner removes a row.
 */
export class GenerationRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
  }

  private get generationModel() {
    return new GenerationModel(this.db, this.userId, this.workspaceId);
  }

  /** The topic to add a request to: the caller's own `topicId`, or a new topic. */
  private async resolveTopic(kind: GenerationKind, prompt: string, topicId?: string) {
    if (topicId) {
      const topic = await new GenerationTopicModel(this.db, this.userId, this.workspaceId).findById(
        topicId,
      );
      if (!topic) throw this.createNotFoundError('Generation topic not found');
      if (topic.type !== kind) {
        throw new ApiException(
          400,
          'validation_error',
          `Invalid request: topicId is a ${topic.type} topic, not ${kind}`,
          [{ message: `Expected a ${kind} topic`, path: 'body.topicId' }],
        );
      }
      return topic.id;
    }

    const id = await generationTopicRouter.createCaller(this.ctx).createTopic({
      title: prompt.trim().slice(0, 100),
      type: kind,
    });
    return id as string;
  }

  private async toPayload(row: GenerationWithBatch): Promise<GenerationPayload> {
    const generation = await this.generationModel.transformGeneration(row);
    const kind = row.batch.topic?.type;

    return {
      asset: toAssetPayload(generation.asset),
      batchId: row.batch.id,
      createdAt: new Date(row.createdAt).toISOString(),
      error: toErrorPayload(generation.task.error),
      fileId: generation.fileId ?? null,
      id: row.id,
      model: row.batch.model,
      prompt: row.batch.prompt,
      provider: row.batch.provider,
      seed: row.seed ?? null,
      status: generation.task.status as GenerationPayload['status'],
      topicId: row.batch.generationTopicId,
      type: (GENERATION_KINDS as readonly string[]).includes(kind ?? '')
        ? (kind as GenerationPayload['type'])
        : 'image',
    };
  }

  /** A generation row with its task status brought up to date (timed-out tasks fail). */
  private async findFresh(id: string): Promise<GenerationWithBatch | undefined> {
    const row = await this.generationModel.findByIdWithBatch(id);
    if (!row?.asyncTaskId || isTerminal(row.asyncTask?.status ?? 'pending')) return row;

    await new AsyncTaskModel(this.db, this.userId, this.workspaceId).checkTimeoutTasks([
      row.asyncTaskId,
    ]);
    return this.generationModel.findByIdWithBatch(id);
  }

  async getGeneration(id: string): Promise<GenerationPayload> {
    const row = await this.findFresh(id);
    if (!row) throw this.createNotFoundError('Generation not found');
    return this.toPayload(row);
  }

  async listGenerations(query: GenerationListQuery) {
    const { limit, offset } = resolvePagination(query);
    const { items, total } = await this.generationModel.queryWithBatch({
      limit,
      offset,
      type: query.type,
    });
    return { items: await Promise.all(items.map((row) => this.toPayload(row))), total };
  }

  async deleteGeneration(id: string): Promise<DeletedResource> {
    if (!(await this.generationModel.findById(id))) {
      throw this.createNotFoundError('Generation not found');
    }
    await generationRouter.createCaller(this.ctx).deleteGeneration({ generationId: id });
    return { deleted: true, id };
  }

  /** Poll until every generation is final or the deadline passes. */
  private async waitForGenerations(ids: string[], timeoutSeconds: number) {
    const deadline = Date.now() + timeoutSeconds * 1000;
    let rows = await Promise.all(ids.map((id) => this.findFresh(id)));

    while (
      rows.some((row) => row && !isTerminal(row.asyncTask?.status ?? 'pending')) &&
      Date.now() + WAIT_POLL_INTERVAL_MS <= deadline
    ) {
      await sleep(WAIT_POLL_INTERVAL_MS);
      rows = await Promise.all(ids.map((id) => this.findFresh(id)));
    }

    return rows;
  }

  private async batchPayload(
    batchId: string,
    topicId: string,
    ids: string[],
    rows?: (GenerationWithBatch | undefined)[],
  ): Promise<GenerationBatchCreated> {
    const resolved = rows ?? (await Promise.all(ids.map((id) => this.findFresh(id))));
    const generations = await Promise.all(
      resolved.filter((row): row is GenerationWithBatch => !!row).map((row) => this.toPayload(row)),
    );
    return { batchId, generations, topicId };
  }

  async createImages(body: CreateImageGenerationRequest): Promise<GenerationBatchCreated> {
    const topicId = await this.resolveTopic('image', body.prompt, body.topicId);

    const result = await imageRouter.createCaller(this.ctx).createImage({
      generationTopicId: topicId,
      imageNum: body.n,
      model: body.model,
      params: withoutUndefined({
        ...body.params,
        cfg: body.cfg,
        height: body.height,
        imageUrls: body.imageUrls,
        prompt: body.prompt,
        seed: body.seed,
        steps: body.steps,
        width: body.width,
      }),
      provider: body.provider,
    });

    const ids = result.data.generations.map((generation) => generation.id as string);
    const rows = body.wait
      ? await this.waitForGenerations(ids, body.waitTimeoutSeconds)
      : undefined;
    return this.batchPayload(result.data.batch.id as string, topicId, ids, rows);
  }

  async createVideo(body: CreateVideoGenerationRequest): Promise<GenerationBatchCreated> {
    if (
      body.previousGenerationId &&
      !(await this.generationModel.findById(body.previousGenerationId))
    ) {
      throw this.createNotFoundError('Previous generation not found');
    }
    const topicId = await this.resolveTopic('video', body.prompt, body.topicId);

    const result = await videoRouter.createCaller(this.ctx).createVideo({
      generationTopicId: topicId,
      model: body.model,
      params: withoutUndefined({
        ...body.params,
        aspectRatio: body.aspectRatio,
        cameraFixed: body.cameraFixed,
        duration: body.duration,
        endImageUrl: body.endImageUrl,
        generateAudio: body.generateAudio,
        imageUrl: body.imageUrl,
        prompt: body.prompt,
        resolution: body.resolution,
        seed: body.seed,
      }),
      previousGenerationId: body.previousGenerationId,
      provider: body.provider,
    });

    const ids = result.data.generations.map((generation) => generation.id as string);
    return this.batchPayload(result.data.batch.id as string, topicId, ids);
  }
}
