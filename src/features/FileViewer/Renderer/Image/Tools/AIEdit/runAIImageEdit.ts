import type { AsyncTaskError, Generation } from '@lobechat/types';
import { AsyncTaskStatus } from '@lobechat/types';

import {
  buildDerivedFileMetadata,
  buildDerivedFileName,
  DERIVED_FILE_SUFFIX,
} from '../../geometry';
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
  createTopic: (title: string) => Promise<string>;
  deleteTopic: (id: string) => Promise<unknown>;
  /** Read a file's location and metadata; never used to write. */
  getFile: (id: string) => Promise<
    | {
        knowledgeBaseIds?: string[];
        metadata?: Record<string, unknown> | null;
        parentId?: string | null;
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
  signal?: AbortSignal;
  source: AIEditSource;
  timeout?: number;
  /** Name of the generation topic the edit is recorded under. */
  topicTitle: string;
}

export interface AIEditResult {
  fileId: string;
  height?: number;
  name: string;
  url: string;
  width?: number;
}

const DEFAULT_POLL_INTERVAL = 2000;
const DEFAULT_TIMEOUT = 3 * 60 * 1000;

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

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new AIImageEditError('cancelled');
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
 * cancelling or timing out only stops the client from waiting: the topic and
 * erase guide are kept for the task, and its result appears in the generation
 * topic. Cleanup only happens when the task never started or has finished.
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
  timeout = DEFAULT_TIMEOUT,
  topicTitle,
}: RunAIImageEditParams): Promise<AIEditResult> => {
  let guideFileId: string | undefined;
  let topicId: string | undefined;
  let kept = false;
  let submitted = false;
  let settled = false;

  try {
    let imageUrl = source.url;

    if (operation === 'erase') {
      if (!guide) throw new AIImageEditError('failed', 'Missing erase guide image');
      onPhase?.('uploading');
      const uploaded = await deps.uploadFile({
        file: new File([guide], buildDerivedFileName(source.name, 'erase-guide'), {
          type: 'image/png',
        }),
      });
      if (!uploaded) throw new AIImageEditError('failed', 'Failed to upload the erase guide');
      guideFileId = uploaded.id;
      imageUrl = uploaded.url;
      throwIfAborted(signal);
    }

    onPhase?.('generating');
    topicId = await deps.createTopic(topicTitle);
    throwIfAborted(signal);

    const created = await deps.createImage(
      buildAIEditRequest({ generationTopicId: topicId, imageUrl, model, operation }),
    );
    const pending = created?.data?.generations?.[0];
    if (!created?.success || !pending?.id || !pending.asyncTaskId)
      throw new AIImageEditError('failed', 'The image task could not be started');
    submitted = true;

    const deadline = Date.now() + timeout;
    let generation: Generation | null = null;
    while (!generation) {
      await sleep(pollInterval, signal);
      const status = await deps.getStatus(pending.id, pending.asyncTaskId);
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
    // know where the original lives, so ask the server for its folder and libraries.
    const location = await deps.getFile(source.fileId);
    const parentId = source.parentId ?? location?.parentId ?? undefined;

    let fileId = generation.fileId ?? undefined;
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
      });
      if (!uploaded) throw new AIImageEditError('failed', 'Failed to save the edited image');
      fileId = uploaded.id;
      url = uploaded.url;
    }

    for (const knowledgeBaseId of location?.knowledgeBaseIds ?? []) {
      // The file is already saved; a library link that fails only hides it there.
      await deps.addToKnowledgeBase(knowledgeBaseId, [fileId]).catch((error) => {
        console.error('[ImageViewer] failed to add the edited image to its library', error);
      });
    }

    kept = true;
    return { fileId, height: asset.height, name, url, width: asset.width };
  } catch (error) {
    if (signal?.aborted)
      throw new AIImageEditError('cancelled', undefined, error, {
        taskRunning: submitted && !settled,
      });
    if (error instanceof AIImageEditError) throw error;
    throw new AIImageEditError('failed', (error as Error)?.message, error);
  } finally {
    // A task still running on the server needs its topic and its input image;
    // removing them would orphan the result it is about to store.
    const abandoned = submitted && !settled;
    // Cleanup is best effort and must never mask the outcome.
    if (topicId && !kept && !abandoned) await deps.deleteTopic(topicId).catch(() => undefined);
    if (guideFileId && !abandoned) await deps.removeFile(guideFileId).catch(() => undefined);
  }
};
