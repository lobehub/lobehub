import type {
  CreateImageMethodOptions,
  CreateImageResponse,
  ModelRuntime,
} from '@lobechat/model-runtime';
import { sha256 } from 'js-sha256';
import type { RuntimeImageGenParams } from 'model-bank';

import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { FileService, getFileProxyUrl } from '@/server/services/file';
import { fetchImageFromUrl, GenerationService } from '@/server/services/generation';

import type {
  CollaborativeAgentBlockRewriteImageTarget,
  RewriteGeneratorInput,
  RewriteGeneratorOutput,
} from './worker';

export const BLOCK_IMAGE_REWRITE_ADAPTER_ID = 'block-image' as const;
export const BLOCK_IMAGE_DEFAULT_MODEL = 'openai/gpt-image-2' as const;

export const normalizeBlockImageModel = (model: string, provider: string): string =>
  provider === 'zenmux' && model === 'gpt-image-2' ? BLOCK_IMAGE_DEFAULT_MODEL : model;

const DOCUMENT_REWRITE_IMAGE_STORAGE_PREFIX = 'document-rewrites/images';

type ImageRuntime = Pick<ModelRuntime, 'createImage'>;

export interface BlockImageRewriteOptions {
  db: LobeChatDatabase;
  model: string;
  provider: string;
  reportedModel?: string;
  runtime: ImageRuntime;
  userId: string;
  workspaceId?: string | null;
}

export interface StoredBlockImageAsset {
  fileId: string;
  height: number;
  url: string;
  width: number;
}

export type BlockImageRewriteFailureCategory =
  'database' | 'image_processing' | 'input' | 'provider' | 'storage' | 'unknown';

export type BlockImageRewriteFailureStage =
  | 'cache_lookup'
  | 'document_lookup'
  | 'file_record'
  | 'image_transform'
  | 'provider'
  | 'source_resolution'
  | 'storage_upload'
  | 'validation';

interface BlockImageRewriteFailureDetails {
  category: BlockImageRewriteFailureCategory;
  stage: BlockImageRewriteFailureStage;
}

export class BlockImageRewriteError extends Error {
  readonly code = 'DOCUMENT_REWRITE_IMAGE_GENERATION_FAILED';
  readonly retryable = false;
  readonly category: BlockImageRewriteFailureCategory;
  readonly stage: BlockImageRewriteFailureStage | 'unknown';

  constructor(
    message = 'Document rewrite image generation failed',
    details: Partial<BlockImageRewriteFailureDetails> = {},
  ) {
    const stage = details.stage ?? 'unknown';
    const category = details.category ?? 'unknown';
    super(stage === 'unknown' ? message : `${message} [${stage}:${category}]`);
    this.name = 'BlockImageRewriteError';
    this.category = category;
    this.stage = stage;
  }
}

const createBlockImageRewriteError = (
  stage: BlockImageRewriteFailureStage,
  category: BlockImageRewriteFailureCategory,
): BlockImageRewriteError =>
  new BlockImageRewriteError(undefined, {
    category,
    stage,
  });

const failureCategoryForStage = (
  stage: BlockImageRewriteFailureStage,
): BlockImageRewriteFailureCategory => {
  switch (stage) {
    case 'cache_lookup':
    case 'document_lookup':
    case 'file_record': {
      return 'database';
    }
    case 'image_transform': {
      return 'image_processing';
    }
    case 'provider': {
      return 'provider';
    }
    case 'source_resolution':
    case 'validation': {
      return 'input';
    }
    case 'storage_upload': {
      return 'storage';
    }
  }
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new Error('Document rewrite image generation was canceled');
  }
};

const imageFingerprint = (input: {
  instruction: string;
  model: string;
  provider: string;
  requestId: string;
  sourceHash: string;
}): string =>
  sha256(
    JSON.stringify([
      input.requestId,
      input.instruction,
      input.model,
      input.provider,
      input.sourceHash,
    ]),
  ).slice(0, 40);

const imageFileIdForRequest = (input: {
  instruction: string;
  model: string;
  provider: string;
  requestId: string;
  sourceHash: string;
}): string => `document-rewrite-${imageFingerprint(input)}`;

const imageStorageKeyForRequest = (
  input: {
    instruction: string;
    model: string;
    provider: string;
    requestId: string;
    sourceHash: string;
  },
  extension: string,
  imageHash: string,
): string =>
  `${DOCUMENT_REWRITE_IMAGE_STORAGE_PREFIX}/${imageFingerprint(input)}-${sha256(imageHash).slice(0, 40)}.${extension.replaceAll(/[^a-z0-9]/giu, '') || 'png'}`;

const parseImageSource = (src: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(src, 'http://document-rewrite-file.invalid');
  } catch {
    throw new Error('Block image reference is not a valid file URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Block image reference must use http(s) or a root-relative URL');
  }
  return parsed;
};

const isTrustedFileProxySource = (src: string, parsed: URL): boolean => {
  if (src.startsWith('/f/')) return true;
  if (!/^https?:\/\//iu.test(src) || !parsed.pathname.startsWith('/f/')) return false;
  try {
    return new URL(appEnv.APP_URL).origin === parsed.origin;
  } catch {
    return false;
  }
};

const extractFileId = (parsed: URL): string => {
  if (parsed.pathname === '/f/' || !parsed.pathname.startsWith('/f/')) {
    throw new Error('Block image reference must use the file proxy');
  }
  const fileId = decodeURIComponent(parsed.pathname.slice('/f/'.length));
  if (!fileId || fileId.includes('/')) {
    throw new Error('Block image reference has an invalid file id');
  }
  return fileId;
};

const toImageDataUri = (buffer: Uint8Array, mimeType: string): string => {
  const normalizedMime = mimeType.trim().toLowerCase().startsWith('image/')
    ? mimeType.trim().toLowerCase()
    : 'image/png';
  return `data:${normalizedMime};base64,${Buffer.from(buffer).toString('base64')}`;
};

/** Resolve a block image using scoped storage or an SSRF-safe public fetch. */
export const resolveBlockImageReference = async (input: {
  db: LobeChatDatabase;
  signal?: AbortSignal;
  src: string;
  userId: string;
  workspaceId?: string | null;
}): Promise<string> => {
  const parsed = parseImageSource(input.src);
  const { fileModel, fileService } = createImageFileServices(input);
  let file;

  if (isTrustedFileProxySource(input.src, parsed)) {
    file = await fileModel.findById(extractFileId(parsed));
    if (!file) throw new Error('Block image reference is not accessible');
  } else if (!parsed.pathname.startsWith('/f/')) {
    // Dev access URLs may be storage URLs. Accept them only when their key
    // maps back to a file owned by this user/workspace and the canonical
    // storage origin/path matches. `getKeyFromFullUrl` alone intentionally has
    // broader legacy semantics and must not turn an arbitrary foreign URL into
    // a private file reference.
    const key = await fileService.getKeyFromFullUrl(input.src);
    const candidate = key ? await fileModel.findByUrl(key) : undefined;
    if (candidate) {
      try {
        const canonical = new URL(await fileService.getFullFileUrl(candidate.url));
        if (canonical.origin === parsed.origin && canonical.pathname === parsed.pathname) {
          file = candidate;
        }
      } catch {
        // Fall through to the SSRF-safe public fetch path below.
      }
    }
  }

  if (file) {
    if (!file.fileType.toLowerCase().startsWith('image/')) {
      throw new Error('Block image reference is not an image file');
    }
    throwIfAborted(input.signal ?? new AbortController().signal);
    const bytes = await fileService.getFileByteArray(file.url);
    throwIfAborted(input.signal ?? new AbortController().signal);
    return toImageDataUri(bytes, file.fileType);
  }

  if (!/^https?:\/\//iu.test(input.src)) {
    throw new Error('Block image reference is not accessible');
  }
  const fetched = await fetchImageFromUrl(input.src, undefined, input.signal);
  return toImageDataUri(fetched.buffer, fetched.mimeType);
};

export const resolveOwnedBlockImageReference = resolveBlockImageReference;

const readExistingAsset = async (input: {
  expected: {
    fingerprint: string;
    model: string;
    provider: string;
    requestId: string;
    sourceHash: string;
  };
  fileModel: FileModel;
  fileService: FileService;
  fileId: string;
}): Promise<StoredBlockImageAsset | undefined> => {
  const file = await input.fileModel.findById(input.fileId);
  if (!file) return undefined;
  const metadata = file.metadata as Record<string, unknown> | null | undefined;
  if (
    metadata?.documentRewriteModel !== input.expected.model ||
    metadata?.documentRewriteProvider !== input.expected.provider ||
    metadata?.documentRewriteRequestId !== input.expected.requestId ||
    metadata?.documentRewriteFingerprint !== input.expected.fingerprint ||
    metadata?.documentRewriteSourceHash !== input.expected.sourceHash
  ) {
    return undefined;
  }

  try {
    await input.fileService.getFileMetadata(file.url);
  } catch (error) {
    const candidate = error as {
      Code?: unknown;
      code?: unknown;
      status?: unknown;
      message?: unknown;
    };
    const code = String(candidate.Code ?? candidate.code ?? '').toLowerCase();
    const message = String(candidate.message ?? '').toLowerCase();
    const status = Number(candidate.status);
    const definitelyMissing =
      status === 404 ||
      code === 'nosuchkey' ||
      code === 'notfound' ||
      /no such key|not found|does not exist/iu.test(message);
    if (definitelyMissing) return undefined;
    throw createBlockImageRewriteError('cache_lookup', 'storage');
  }

  return {
    fileId: file.id,
    height: Number(metadata?.height) || 0,
    url: getFileProxyUrl(file.id),
    width: Number(metadata?.width) || 0,
  };
};

const createImageFileServices = (input: {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}) => {
  const fileService = new FileService(input.db, input.userId, input.workspaceId ?? undefined);
  const fileModel = new FileModel(input.db, input.userId, input.workspaceId ?? undefined);
  return { fileModel, fileService };
};

export const findStoredBlockImageAsset = async (input: {
  db: LobeChatDatabase;
  instruction: string;
  model: string;
  provider: string;
  requestId: string;
  sourceHash: string;
  userId: string;
  workspaceId?: string | null;
}): Promise<StoredBlockImageAsset | undefined> => {
  const { fileModel, fileService } = createImageFileServices(input);
  const fileId = imageFileIdForRequest(input);

  return readExistingAsset({
    expected: {
      fingerprint: imageFingerprint(input),
      model: input.model,
      provider: input.provider,
      requestId: input.requestId,
      sourceHash: input.sourceHash,
    },
    fileId,
    fileModel,
    fileService,
  });
};

const persistBlockImageAsset = async (input: {
  attempt: number;
  db: LobeChatDatabase;
  documentId: string;
  generation: CreateImageResponse;
  instruction: string;
  model: string;
  provider: string;
  requestId: string;
  signal: AbortSignal;
  sourceHash: string;
  userId: string;
  workspaceId?: string | null;
}): Promise<StoredBlockImageAsset> => {
  const { fileModel, fileService } = createImageFileServices(input);
  const fileId = imageFileIdForRequest(input);
  let stage: BlockImageRewriteFailureStage = 'cache_lookup';

  try {
    const existing = await readExistingAsset({
      expected: {
        fingerprint: imageFingerprint(input),
        model: input.model,
        provider: input.provider,
        requestId: input.requestId,
        sourceHash: input.sourceHash,
      },
      fileId,
      fileModel,
      fileService,
    });
    if (existing) return existing;

    throwIfAborted(input.signal);
    stage = 'document_lookup';
    const document = await new DocumentModel(
      input.db,
      input.userId,
      input.workspaceId ?? undefined,
    ).findById(input.documentId);
    if (!document) throw new Error('Document rewrite document is not accessible');

    stage = 'image_transform';
    const generationService = new GenerationService(
      input.db,
      input.userId,
      input.workspaceId ?? undefined,
    );
    const { image } = await generationService.transformImageForGeneration(
      input.generation.imageUrl,
      undefined,
      input.signal,
    );
    throwIfAborted(input.signal);

    const storageKey = imageStorageKeyForRequest(input, image.extension, image.hash);
    stage = 'storage_upload';
    await fileService.uploadBuffer(storageKey, image.buffer, image.mime);

    // Once bytes are uploaded, finish the scoped file row even if cancellation
    // arrived during the upload. The following signal check prevents any
    // document/Yjs patch while preserving this request's asset for a safe retry.
    let file: StoredBlockImageAsset | undefined;
    try {
      stage = 'file_record';
      const created = await fileService.createFileRecord({
        fileHash: image.hash,
        fileType: image.mime,
        id: fileId,
        metadata: {
          documentRewriteFingerprint: imageFingerprint(input),
          documentRewriteAttempt: input.attempt,
          documentRewriteModel: input.model,
          documentRewriteProvider: input.provider,
          documentRewriteRequestId: input.requestId,
          documentRewriteSourceHash: input.sourceHash,
          height: image.height,
          path: storageKey,
          width: image.width,
        },
        name: `${fileId}.${image.extension}`,
        size: image.size,
        url: storageKey,
        ...(document.visibility ? { visibility: document.visibility } : {}),
      });
      file = {
        fileId: created.fileId,
        height: image.height,
        url: getFileProxyUrl(created.fileId),
        width: image.width,
      };
    } catch {
      // A redelivered worker may race the first attempt after its upload. Reuse
      // the row if the other attempt committed it; otherwise preserve the
      // original persistence error.
      file = await readExistingAsset({
        expected: {
          fingerprint: imageFingerprint(input),
          model: input.model,
          provider: input.provider,
          requestId: input.requestId,
          sourceHash: input.sourceHash,
        },
        fileId,
        fileModel,
        fileService,
      });
      if (!file) throw new Error('Failed to persist generated block image asset');
    }

    throwIfAborted(input.signal);
    return file;
  } catch (error) {
    if (input.signal.aborted) throw error;
    if (error instanceof BlockImageRewriteError) throw error;
    throw createBlockImageRewriteError(stage, failureCategoryForStage(stage));
  }
};

const validateImageTarget = (
  target: CollaborativeAgentBlockRewriteImageTarget | undefined,
): CollaborativeAgentBlockRewriteImageTarget => {
  if (!target) throw new Error('Block image target projection is missing');
  if (typeof target.src !== 'string' || typeof target.status !== 'string') {
    throw new Error('Block image target projection is invalid');
  }
  if (!['uploaded', 'loading', 'error'].includes(target.status)) {
    throw new Error('Block image target status is invalid');
  }
  if (typeof target.placeholder !== 'boolean') {
    throw new Error('Block image target placeholder flag is invalid');
  }
  return target;
};

const createBlockImageOutput = (
  input: RewriteGeneratorInput,
  options: BlockImageRewriteOptions,
  asset: StoredBlockImageAsset,
): RewriteGeneratorOutput => {
  const patch: Record<string, unknown> = { src: asset.url };
  if (asset.width > 0) patch.width = asset.width;
  if (asset.height > 0) patch.height = asset.height;

  return {
    generationId: `${input.requestId}:generation:${input.attempt}`,
    model: options.reportedModel ?? options.model,
    provider: options.provider,
    replacementBlock: { kind: 'patch', patch },
  };
};

/**
 * Generate or edit one block image. The target image projection is supplied by
 * the live editor adapter, while prompt/model/provider come from the durable
 * rewrite request and resolved Agent runtime.
 */
export const generateBlockImageRewrite = async (
  input: RewriteGeneratorInput,
  options: BlockImageRewriteOptions,
): Promise<RewriteGeneratorOutput> => {
  if (
    input.adapterId !== BLOCK_IMAGE_REWRITE_ADAPTER_ID ||
    input.targetKind !== 'node' ||
    input.outputSchema !== 'patch'
  ) {
    throw new Error('Block image generation requires the block-image patch adapter');
  }

  let stage: BlockImageRewriteFailureStage = 'validation';
  try {
    const target = validateImageTarget(input.blockImage);
    const source = target.src.trim();
    const isPlaceholder = source.length === 0 && target.placeholder;
    if ((source.length === 0) !== target.placeholder) {
      throw new Error('Block image placeholder projection is inconsistent');
    }
    if (isPlaceholder && target.status === 'uploaded') {
      throw new Error('Block image placeholder has an uploaded status');
    }
    if (!isPlaceholder && target.status === 'loading') {
      throw new Error('Block image target is still loading');
    }
    if (!isPlaceholder && target.status !== 'uploaded' && target.status !== 'error') {
      throw new Error('Block image target is not ready for editing');
    }
    if (!input.sourceHash) throw new Error('Block image source proof is missing');

    stage = 'cache_lookup';
    const cached = await findStoredBlockImageAsset({
      db: options.db,
      instruction: input.instruction,
      model: options.model,
      provider: options.provider,
      requestId: input.requestId,
      sourceHash: input.sourceHash,
      userId: options.userId,
      workspaceId: options.workspaceId,
    });
    if (cached) {
      throwIfAborted(input.signal);
      return createBlockImageOutput(input, options, cached);
    }

    stage = 'source_resolution';
    const params: RuntimeImageGenParams = {
      ...(isPlaceholder
        ? {}
        : {
            imageUrl: await resolveBlockImageReference({
              db: options.db,
              signal: input.signal,
              src: source,
              userId: options.userId,
              workspaceId: options.workspaceId,
            }),
          }),
      prompt: input.instruction,
    } as RuntimeImageGenParams;

    throwIfAborted(input.signal);
    stage = 'provider';
    const response = await options.runtime.createImage(
      {
        model: options.model,
        params,
      },
      {
        metadata: {
          attempt: input.attempt,
          requestId: input.requestId,
          trigger: 'document_rewrite_image',
        },
        maxRetries: 0,
        signal: input.signal,
      } satisfies CreateImageMethodOptions,
    );
    if (!response) throw new Error('Image runtime returned no image');

    stage = 'image_transform';
    const asset = await persistBlockImageAsset({
      attempt: input.attempt,
      db: options.db,
      documentId: input.documentId,
      generation: response,
      instruction: input.instruction,
      model: options.model,
      provider: options.provider,
      requestId: input.requestId,
      signal: input.signal,
      sourceHash: input.sourceHash,
      userId: options.userId,
      workspaceId: options.workspaceId,
    });
    return createBlockImageOutput(input, options, asset);
  } catch (error) {
    if (input.signal.aborted) throw error;
    if (error instanceof BlockImageRewriteError) throw error;
    throw createBlockImageRewriteError(stage, failureCategoryForStage(stage));
  }
};
