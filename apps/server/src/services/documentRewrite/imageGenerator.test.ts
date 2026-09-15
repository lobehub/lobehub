// @vitest-environment node
import { sha256 } from 'js-sha256';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BlockImageRewriteError,
  generateBlockImageRewrite,
  normalizeBlockImageModel,
  resolveBlockImageReference,
} from './imageGenerator';
import type { RewriteGeneratorInput } from './worker';

const mocks = vi.hoisted(() => ({
  documentModel: {
    findById: vi.fn(),
  },
  fileModel: {
    findById: vi.fn(),
    findByUrl: vi.fn(),
  },
  fileService: {
    createFileRecord: vi.fn(),
    getFullFileUrl: vi.fn(),
    getFileByteArray: vi.fn(),
    getFileMetadata: vi.fn(),
    getKeyFromFullUrl: vi.fn(),
    uploadBuffer: vi.fn(),
  },
  generationService: {
    transformImageForGeneration: vi.fn(),
  },
  fetchImageFromUrl: vi.fn(),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(function () {
    return mocks.fileModel;
  }),
}));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return mocks.documentModel;
  }),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return mocks.fileService;
  }),
  getFileProxyUrl: (fileId: string) => `/f/${fileId}`,
}));
vi.mock('@/server/services/generation', () => ({
  GenerationService: vi.fn(function () {
    return mocks.generationService;
  }),
  fetchImageFromUrl: mocks.fetchImageFromUrl,
}));

const signal = new AbortController().signal;
const requestFingerprint = sha256(
  JSON.stringify(['request-1', 'Draw a blue mountain', 'gpt-image-2', 'zenmux', 'fnv1a-source']),
).slice(0, 40);

const makeInput = (
  blockImage: RewriteGeneratorInput['blockImage'],
  inputSignal: AbortSignal = signal,
): RewriteGeneratorInput => ({
  agentId: 'agent-1',
  adapterId: 'block-image',
  attempt: 1,
  blockImage,
  documentId: 'document-1',
  instruction: 'Draw a blue mountain',
  nodeType: 'block-image',
  outputSchema: 'patch',
  quotedText: '{"src":""}',
  requestId: 'request-1',
  signal: inputSignal,
  sourceHash: 'fnv1a-source',
  targetKind: 'node',
  targetNodeId: 'block-1',
  targetNodeIds: ['block-1'],
});

const placeholder = {
  altText: '',
  height: null,
  maxWidth: null,
  placeholder: true,
  src: '',
  status: 'loading' as const,
  width: null,
};

const options = {
  db: {} as never,
  model: 'gpt-image-2',
  provider: 'zenmux',
  runtime: { createImage: vi.fn() },
  userId: 'user-1',
  workspaceId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.documentModel.findById.mockResolvedValue({ visibility: 'private' });
  mocks.fileModel.findById.mockResolvedValue(undefined);
  mocks.fileModel.findByUrl.mockResolvedValue(undefined);
  mocks.fileService.getFileMetadata.mockResolvedValue({ contentLength: 4 });
  mocks.fileService.uploadBuffer.mockResolvedValue({ key: 'generated/key.png' });
  mocks.fileService.createFileRecord.mockResolvedValue({
    fileId: 'generated-file-1',
    url: 'https://storage.invalid/generated/key.png',
  });
  mocks.generationService.transformImageForGeneration.mockResolvedValue({
    image: {
      buffer: Buffer.from('png'),
      extension: 'png',
      hash: 'image-hash',
      height: 768,
      mime: 'image/png',
      size: 3,
      width: 1024,
    },
    thumbnailImage: {},
  });
  options.runtime.createImage.mockResolvedValue({
    imageUrl: 'https://provider.invalid/generated.png',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateBlockImageRewrite', () => {
  it('uses ZenMux canonical model naming without rewriting another provider', () => {
    expect(normalizeBlockImageModel('gpt-image-2', 'zenmux')).toBe('openai/gpt-image-2');
    expect(normalizeBlockImageModel('gpt-image-2', 'custom-anthropic')).toBe('gpt-image-2');
  });

  it('generates a placeholder with the request prompt and stores a stable file proxy', async () => {
    const result = await generateBlockImageRewrite(makeInput(placeholder), options);

    expect(options.runtime.createImage).toHaveBeenCalledWith(
      {
        model: 'gpt-image-2',
        params: { prompt: 'Draw a blue mountain' },
      },
      expect.objectContaining({ maxRetries: 0, signal }),
    );
    expect(mocks.generationService.transformImageForGeneration).toHaveBeenCalledWith(
      'https://provider.invalid/generated.png',
      undefined,
      signal,
    );
    expect(result).toMatchObject({
      replacementBlock: {
        kind: 'patch',
        patch: { height: 768, src: '/f/generated-file-1', width: 1024 },
      },
    });
    expect(mocks.fileService.createFileRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringContaining('document-rewrite-'),
        metadata: expect.objectContaining({
          documentRewriteFingerprint: requestFingerprint,
          documentRewriteModel: 'gpt-image-2',
          documentRewriteProvider: 'zenmux',
          documentRewriteSourceHash: 'fnv1a-source',
        }),
        visibility: 'private',
      }),
    );
  });

  it('reuses a matching stored request asset without calling the paid provider again', async () => {
    mocks.fileModel.findById.mockResolvedValue({
      fileType: 'image/png',
      id: 'cached-file-1',
      metadata: {
        documentRewriteFingerprint: requestFingerprint,
        documentRewriteModel: 'gpt-image-2',
        documentRewriteProvider: 'zenmux',
        documentRewriteRequestId: 'request-1',
        documentRewriteSourceHash: 'fnv1a-source',
        height: 512,
        width: 512,
      },
      url: 'cached/key.png',
    });

    const result = await generateBlockImageRewrite(makeInput(placeholder), options);

    expect(options.runtime.createImage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      replacementBlock: { kind: 'patch', patch: { src: '/f/cached-file-1' } },
    });
  });

  it('does not turn a storage timeout into a second paid generation', async () => {
    mocks.fileModel.findById.mockResolvedValue({
      fileType: 'image/png',
      id: 'cached-file-1',
      metadata: {
        documentRewriteFingerprint: requestFingerprint,
        documentRewriteModel: 'gpt-image-2',
        documentRewriteProvider: 'zenmux',
        documentRewriteRequestId: 'request-1',
        documentRewriteSourceHash: 'fnv1a-source',
      },
      url: 'cached/key.png',
    });
    mocks.fileService.getFileMetadata.mockRejectedValue(new Error('storage timeout'));

    await expect(generateBlockImageRewrite(makeInput(placeholder), options)).rejects.toMatchObject({
      code: 'DOCUMENT_REWRITE_IMAGE_GENERATION_FAILED',
      category: 'storage',
      retryable: false,
      stage: 'cache_lookup',
    });
    expect(options.runtime.createImage).not.toHaveBeenCalled();
  });

  it('classifies image transformation failures without retaining the provider error', async () => {
    mocks.generationService.transformImageForGeneration.mockRejectedValue(
      new Error('sharp internals must stay out of durable errors'),
    );

    const error = await generateBlockImageRewrite(makeInput(placeholder), options).catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(BlockImageRewriteError);
    expect(error).toMatchObject({
      category: 'image_processing',
      code: 'DOCUMENT_REWRITE_IMAGE_GENERATION_FAILED',
      retryable: false,
      stage: 'image_transform',
    });
    expect((error as Error).message).not.toContain('sharp internals');
  });

  it('classifies storage upload failures before file-record persistence', async () => {
    mocks.fileService.uploadBuffer.mockRejectedValue(
      new Error('storage credentials must stay out'),
    );

    const error = await generateBlockImageRewrite(makeInput(placeholder), options).catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(BlockImageRewriteError);
    expect(error).toMatchObject({
      category: 'storage',
      code: 'DOCUMENT_REWRITE_IMAGE_GENERATION_FAILED',
      retryable: false,
      stage: 'storage_upload',
    });
    expect((error as Error).message).not.toContain('storage credentials');
    expect(mocks.fileService.createFileRecord).not.toHaveBeenCalled();
  });

  it('checks cancellation before returning a cached asset', async () => {
    const controller = new AbortController();
    controller.abort();
    mocks.fileModel.findById.mockResolvedValue({
      fileType: 'image/png',
      id: 'cached-file-1',
      metadata: {
        documentRewriteFingerprint: requestFingerprint,
        documentRewriteModel: 'gpt-image-2',
        documentRewriteProvider: 'zenmux',
        documentRewriteRequestId: 'request-1',
        documentRewriteSourceHash: 'fnv1a-source',
      },
      url: 'cached/key.png',
    });

    await expect(
      generateBlockImageRewrite(makeInput(placeholder, controller.signal), options),
    ).rejects.toThrow('canceled');
    expect(options.runtime.createImage).not.toHaveBeenCalled();
  });

  it('reads an owned proxy reference into a data URI before image editing', async () => {
    mocks.fileModel.findById.mockImplementation(async (id: string) =>
      id === 'source-file-1' ? { fileType: 'image/png', id, url: 'source/key.png' } : undefined,
    );
    mocks.fileService.getFileByteArray.mockResolvedValue(Buffer.from('source-image'));

    const result = await generateBlockImageRewrite(
      makeInput({
        ...placeholder,
        placeholder: false,
        src: '/f/source-file-1',
        status: 'uploaded',
      }),
      options,
    );

    const params = options.runtime.createImage.mock.calls[0]?.[0].params;
    expect(params.imageUrl).toBe(
      `data:image/png;base64,${Buffer.from('source-image').toString('base64')}`,
    );
    expect(result).toMatchObject({ replacementBlock: { kind: 'patch' } });
  });

  it('resolves a development storage URL only through a scoped file row', async () => {
    mocks.fileService.getKeyFromFullUrl.mockResolvedValue('source/key.png');
    mocks.fileService.getFullFileUrl.mockResolvedValue(
      'https://storage.invalid/source/key.png?signature=ours',
    );
    mocks.fileModel.findByUrl.mockResolvedValue({
      fileType: 'image/jpeg',
      id: 'source-file-2',
      url: 'source/key.png',
    });
    mocks.fileService.getFileByteArray.mockResolvedValue(Buffer.from('local-image'));

    await expect(
      resolveBlockImageReference({
        db: {} as never,
        src: 'https://storage.invalid/source/key.png?signature=redacted',
        userId: 'user-1',
        workspaceId: null,
      }),
    ).resolves.toBe(`data:image/jpeg;base64,${Buffer.from('local-image').toString('base64')}`);
    expect(mocks.fileModel.findByUrl).toHaveBeenCalledWith('source/key.png');
  });

  it("does not replace a foreign same-path image with the caller's private file", async () => {
    mocks.fileService.getKeyFromFullUrl.mockResolvedValue('source/key.png');
    mocks.fileService.getFullFileUrl.mockResolvedValue(
      'https://storage.invalid/source/key.png?signature=ours',
    );
    mocks.fileModel.findByUrl.mockResolvedValue({
      fileType: 'image/png',
      id: 'private-file',
      url: 'source/key.png',
    });
    mocks.fetchImageFromUrl.mockResolvedValue({
      buffer: Buffer.from('foreign-image'),
      mimeType: 'image/png',
    });

    await expect(
      resolveBlockImageReference({
        db: {} as never,
        src: 'https://foreign.invalid/source/key.png',
        userId: 'user-1',
        workspaceId: null,
      }),
    ).resolves.toBe(`data:image/png;base64,${Buffer.from('foreign-image').toString('base64')}`);
    expect(mocks.fileService.getFileByteArray).not.toHaveBeenCalled();
    expect(mocks.fetchImageFromUrl).toHaveBeenCalledWith(
      'https://foreign.invalid/source/key.png',
      undefined,
      undefined,
    );
  });

  it('treats a foreign /f path as public input instead of a local file id', async () => {
    mocks.fetchImageFromUrl.mockResolvedValue({
      buffer: Buffer.from('public-image'),
      mimeType: 'image/webp',
    });

    await expect(
      resolveBlockImageReference({
        db: {} as never,
        src: 'https://foreign.invalid/f/source-file-1',
        userId: 'user-1',
        workspaceId: null,
      }),
    ).resolves.toBe(`data:image/webp;base64,${Buffer.from('public-image').toString('base64')}`);
    expect(mocks.fileModel.findById).not.toHaveBeenCalled();
    expect(mocks.fetchImageFromUrl).toHaveBeenCalledWith(
      'https://foreign.invalid/f/source-file-1',
      undefined,
      undefined,
    );
  });

  it('keeps concurrent same-request uploads content-addressed and reuses the committed winner', async () => {
    let committed: any;
    let createCalls = 0;
    mocks.fileModel.findById.mockImplementation(async () => committed);
    mocks.fileService.uploadBuffer.mockImplementation(async (key: string) => ({ key }));
    mocks.fileService.createFileRecord.mockImplementation(async (input: any) => {
      createCalls += 1;
      if (committed) throw new Error('duplicate file id');
      committed = {
        fileType: input.fileType,
        id: input.id,
        metadata: input.metadata,
        url: input.url,
      };
      return { fileId: input.id, url: `/f/${input.id}` };
    });
    let runtimeCalls = 0;
    options.runtime.createImage.mockImplementation(async () => ({
      imageUrl: `https://provider.invalid/generated-${++runtimeCalls}.png`,
    }));
    mocks.generationService.transformImageForGeneration.mockImplementation(async (url: string) => ({
      image: {
        buffer: Buffer.from(url),
        extension: 'png',
        hash: url,
        height: 512,
        mime: 'image/png',
        size: url.length,
        width: 512,
      },
      thumbnailImage: {},
    }));

    const [first, second] = await Promise.all([
      generateBlockImageRewrite(makeInput(placeholder), options),
      generateBlockImageRewrite(makeInput(placeholder), options),
    ]);

    expect(createCalls).toBe(2);
    expect(new Set(mocks.fileService.uploadBuffer.mock.calls.map(([key]) => key)).size).toBe(2);
    expect(first.replacementBlock).toEqual(second.replacementBlock);
    expect(first.replacementBlock).toMatchObject({
      patch: { src: `/f/${committed.id}` },
    });
  });
});
