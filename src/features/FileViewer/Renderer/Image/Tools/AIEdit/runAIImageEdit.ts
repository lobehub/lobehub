import type { AsyncTaskError, Generation } from '@lobechat/types';
import { AsyncTaskStatus } from '@lobechat/types';

import {
  buildDerivedFileMetadata,
  buildDerivedFileName,
  DERIVED_FILE_SUFFIX,
} from '../../geometry';
import { fileIdFromProxyUrl } from '../exportImage';
import { fileIntoLibraries } from '../saveDerivedFile';
import { type AIEditModel, type AIEditOperation, buildAIEditRequest } from './request';

export type AIEditErrorKind = 'cancelled' | 'failed' | 'noModel' | 'noResult' | 'timeout';

export class AIImageEditError extends Error {
  kind: AIEditErrorKind;
  /**
   * The server task was submitted and had not finished when the client stopped
   * waiting. Its result still lands in the generation topic.
   */
  taskRunning: boolean;

  constructor(
    kind: AIEditErrorKind,
    message?: string,
    cause?: unknown,
    { taskRunning = false }: { taskRunning?: boolean } = {},
  ) {
    super(message || kind);
    this.name = 'AIImageEditError';
    this.kind = kind;
    this.cause = cause;
    this.taskRunning = taskRunning;
  }
}

export type AIEditPhase = 'uploading' | 'generating' | 'saving';

interface CreateImageResult {
  data?: { generations?: { asyncTaskId?: string | null; id?: string }[] };
  success?: boolean;
}

interface GenerationStatusResult {
  error: AsyncTaskError | null;
  generation: Generation | null;
  status: AsyncTaskStatus | string;
}

/** Everything the edit talks to, injected so the flow is testable without a network. */
export interface AIEditDeps {
  /** File the result into the same library as the original. */
  addToKnowledgeBase: (knowledgeBaseId: string, fileIds: string[]) => Promise<unknown>;
  createImage: (payload: ReturnType<typeof buildAIEditRequest>) => Promise<CreateImageResult>;
  createTopic: (title: string, visibility?: 'private' | 'public') => Promise<string>;
  deleteTopic: (id: string) => Promise<unknown>;
  /** Read a file's location and metadata; never used to write. */
  getFile: (id: string) => Promise<
    | {
        knowledgeBaseIds?: string[];
        metadata?: Record<string, unknown> | null;
        parentId?: string | null;
        visibility?: 'private' | 'public' | null;
      }
    | null
    | undefined
  >;
  getStatus: (generationId: string, asyncTaskId: string) => Promise<GenerationStatusResult>;
  removeFile: (id: string) => Promise<unknown>;
  updateFile: (
    id: string,
    data: { metadata: Record<string, unknown>; name: string; parentId?: string },
  ) => Promise<unknown>;
  /** Upload a file into the library; used for the erase guide and as a fallback for the result. */
  uploadFile: (params: {
    file: File;
    metadata?: Record<string, unknown>;
    parentId?: string;
    visibility?: 'private' | 'public';
  }) => Promise<{ id: string; url: string } | undefined>;
}

export interface AIEditSource {
  fileId: string;
  name?: string;
  parentId?: string | null;
  url: string;
}

export interface RunAIImageEditParams {
  deps: AIEditDeps;
  /** Erase only: the image with the region to remove painted in the mark color. */
  guide?: Blob;
  model: AIEditModel;
  onPhase?: (phase: AIEditPhase) => void;
  operation: AIEditOperation;
  pollInterval?: number;
  /** How long to keep watching an abandoned task so its erase guide can be removed. */
  settleWatch?: number;
  signal?: AbortSignal;
  source: AIEditSource;
  timeout?: number;
  /** Name of the generation topic the edit is recorded under. */
  topicTitle: string;
}

export interface AIEditResult {
  fileId: string;
  height?: number;
  /** Saved, but adding it to one of the original's libraries failed. */
  libraryFailed?: boolean;
  name: string;
  url: string;
  width?: number;
}

const DEFAULT_POLL_INTERVAL = 2000;
const DEFAULT_TIMEOUT = 3 * 60 * 1000;
const DEFAULT_SETTLE_WATCH = 30 * 60 * 1000;
const MAX_SETTLE_WATCH_DELAY = 60 * 1000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AIImageEditError('cancelled'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AIImageEditError('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Settle with `request`, unless cancel or the deadline comes first: a status
 * request that hangs must not keep the tool locked.
 */
export const raceRequest = <T>(request: Promise<T>, deadline: number, signal?: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(new AIImageEditError('cancelled'));
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new AIImageEditError('cancelled'));
    };
    // Whether a task may be running is decided by the caller, which knows
    // whether anything was submitted yet.
    const timer = setTimeout(
      () => {
        finish();
        reject(new AIImageEditError('timeout'));
      },
      Math.max(0, deadline - Date.now()),
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    request.then(
      (value) => {
        finish();
        resolve(value);
      },
      (error) => {
        finish();
        reject(error);
      },
    );
  });

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new AIImageEditError('cancelled');
};

/**
 * Remove the erase guide of a task the client stopped waiting for, once the
 * task settles. Best effort: it lasts while the page stays open.
 */
const removeGuideWhenSettled = async (
  deps: AIEditDeps,
  task: { asyncTaskId: string; id: string },
  guideFileId: string,
  interval: number,
  limit: number,
) => {
  const deadline = Date.now() + limit;
  let delay = interval;
  while (Date.now() < deadline) {
    await sleep(delay);
    const status = await deps.getStatus(task.id, task.asyncTaskId).catch(() => undefined);
    if (status?.status === AsyncTaskStatus.Success || status?.status === AsyncTaskStatus.Error) {
      await deps.removeFile(guideFileId).catch(() => undefined);
      return;
    }
    // Back off while the status endpoint is failing, so an outage does not
    // turn into a steady stream of requests.
    delay = status ? interval : Math.min(delay * 2, MAX_SETTLE_WATCH_DELAY);
  }
};

/** A request the server refused outright (4xx), so it started nothing. */
const isRejectedRequest = (error: unknown) => {
  const status = (error as { data?: { httpStatus?: number } } | undefined)?.data?.httpStatus;
  return typeof status === 'number' && status >= 400 && status < 500;
};

const errorDetail = (error: AsyncTaskError | null | undefined) => {
  const detail = error?.body?.detail;
  if (typeof detail === 'string' && detail) return detail;
  return error?.name;
};

/**
 * Edit an image with the image generation pipeline and keep the output as a
 * new library file next to the source. The source file is only ever read: the
 * result is the generation's own file, renamed and filed beside the original.
 *
 * There is no way to abort a submitted generation task, so once it is running
 * cancelling or timing out only stops the client from waiting. Once anything
 * may have been submitted, the generation topic is kept: it holds the task's
 * record and output, which appear under Image generation. Only a topic that
 * never got a task is deleted. The erase guide is removed once the task has
 * settled, by a background watch when the client stopped waiting earlier.
 */
export const runAIImageEdit = async ({
  deps,
  guide,
  model,
  onPhase,
  operation,
  pollInterval = DEFAULT_POLL_INTERVAL,
  signal,
  source,
  settleWatch = DEFAULT_SETTLE_WATCH,
  timeout = DEFAULT_TIMEOUT,
  topicTitle,
}: RunAIImageEditParams): Promise<AIEditResult> => {
  let guideFileId: string | undefined;
  let topicId: string | undefined;
  let task: { asyncTaskId: string; id: string } | undefined;
  let submitted = false;
  let settled = false;

  // One deadline for the whole run: every step before and after submitting
  // races it and Cancel, so no hung request can keep the tool locked.
  const deadline = Date.now() + timeout;
  const step = <T>(request: Promise<T>) => raceRequest(request, deadline, signal);

  try {
    // The caller may have spent a while preparing the guide; honor a cancel from then.
    throwIfAborted(signal);
    let imageUrl = source.url;
    // Read before the topic exists: the result inherits the topic's visibility,
    // which should follow the original's, and the save step needs the location.
    const location = await step(deps.getFile(source.fileId)).catch((error) => {
      if (error instanceof AIImageEditError) throw error;
      console.error('[ImageViewer] failed to read the original image location', error);
      return undefined;
    });

    if (operation === 'erase') {
      if (!guide) throw new AIImageEditError('failed', 'Missing erase guide image');
      onPhase?.('uploading');
      const uploaded = await step(
        deps.uploadFile({
          file: new File([guide], buildDerivedFileName(source.name, 'erase-guide'), {
            type: 'image/png',
          }),
        }),
      );
      if (!uploaded) throw new AIImageEditError('failed', 'Failed to upload the erase guide');
      guideFileId = uploaded.id;
      imageUrl = uploaded.url;
      throwIfAborted(signal);
    }

    onPhase?.('generating');
    const topicRequest = deps.createTopic(topicTitle, location?.visibility ?? undefined);
    try {
      topicId = await step(topicRequest);
    } catch (error) {
      // Cancelled or timed out while creating: nothing will ever use this
      // topic, so drop it once it arrives.
      void topicRequest.then((id) => deps.deleteTopic(id)).catch(() => undefined);
      throw error;
    }
    throwIfAborted(signal);

    let created: CreateImageResult;
    try {
      created = await step(
        deps.createImage(
          buildAIEditRequest({ generationTopicId: topicId, imageUrl, model, operation }),
        ),
      );
    } catch (error) {
      // The server starts the task before it answers, so a lost, failed or
      // abandoned (cancel/deadline) response may hide a running job. Only an
      // explicit rejection (4xx) proves nothing started.
      if (!isRejectedRequest(error)) submitted = true;
      throw error;
    }
    const pending = created?.data?.generations?.[0];
    if (!created?.success || !pending?.id || !pending.asyncTaskId)
      throw new AIImageEditError('failed', 'The image task could not be started');
    submitted = true;
    task = { asyncTaskId: pending.asyncTaskId, id: pending.id };

    let generation: Generation | null = null;
    while (!generation) {
      await sleep(pollInterval, signal);
      const status = await step(deps.getStatus(pending.id, pending.asyncTaskId));
      if (status.status === AsyncTaskStatus.Success || status.status === AsyncTaskStatus.Error)
        settled = true;
      throwIfAborted(signal);

      if (status.status === AsyncTaskStatus.Success) {
        if (!status.generation?.asset?.url) throw new AIImageEditError('noResult');
        generation = status.generation;
      } else if (status.status === AsyncTaskStatus.Error) {
        throw new AIImageEditError('failed', errorDetail(status.error));
      } else if (Date.now() > deadline) {
        throw new AIImageEditError('timeout', undefined, undefined, { taskRunning: true });
      }
    }

    onPhase?.('saving');
    const asset = generation.asset!;
    const assetUrl = asset.url!;
    const name = buildDerivedFileName(source.name, DERIVED_FILE_SUFFIX[operation]);
    const lineage = buildDerivedFileMetadata(source.fileId, operation);
    // The viewer may be opened from a view (e.g. the image list) that does not
    // know where the original lives, so the server's folder and libraries win.
    // The client's folder is only a fallback for when the lookup failed.
    const parentId = (location ? location.parentId : source.parentId) ?? undefined;

    // Older servers omit `fileId`, but a `/f/:id` asset URL still names the file.
    let fileId = generation.fileId ?? fileIdFromProxyUrl(assetUrl);
    let url = assetUrl;
    if (fileId) {
      // The generation already saved its output as a file; keep its storage
      // metadata and add the lineage, then file it beside the original.
      const metadata = (await deps.getFile(fileId))?.metadata ?? {};
      await deps.updateFile(fileId, { metadata: { ...metadata, ...lineage }, name, parentId });
    } else {
      // Older servers do not report the file; copy the asset into a new one.
      const response = await fetch(assetUrl);
      if (!response.ok) throw new AIImageEditError('noResult', `HTTP ${response.status}`);
      const blob = await response.blob();
      const uploaded = await deps.uploadFile({
        file: new File([blob], name, { type: blob.type || 'image/png' }),
        metadata: lineage,
        parentId,
        visibility: location?.visibility ?? undefined,
      });
      if (!uploaded) throw new AIImageEditError('failed', 'Failed to save the edited image');
      fileId = uploaded.id;
      url = uploaded.url;
    }

    const libraryFailed = await fileIntoLibraries(deps, location?.knowledgeBaseIds, fileId);

    return { fileId, height: asset.height, libraryFailed, name, url, width: asset.width };
  } catch (error) {
    // Once submitted, only a terminal status ends the task; a status request
    // that fails leaves it running on the server.
    const taskRunning = submitted && !settled;
    if (signal?.aborted) throw new AIImageEditError('cancelled', undefined, error, { taskRunning });
    if (error instanceof AIImageEditError) {
      error.taskRunning ||= taskRunning;
      throw error;
    }
    throw new AIImageEditError('failed', (error as Error)?.message, error, { taskRunning });
  } finally {
    // Cleanup is best effort and must never mask the outcome.
    if (topicId && !submitted) await deps.deleteTopic(topicId).catch(() => undefined);
    if (guideFileId) {
      // A task still running needs its input image until it settles.
      if (!submitted || settled) await deps.removeFile(guideFileId).catch(() => undefined);
      else if (task)
        void removeGuideWhenSettled(deps, task, guideFileId, pollInterval, settleWatch);
    }
  }
};
