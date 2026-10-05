/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMockDeps,
  errorStatus,
  realCreateImageResult,
  realProcessingStatus,
  realResultFileMetadata,
  realSuccessStatus,
} from './fixtures';
import { AI_EDIT_PROMPTS } from './request';
import { AIImageEditError, runAIImageEdit } from './runAIImageEdit';

const MODEL = {
  model: 'gemini-3.1-flash-image:image',
  provider: 'lobehub',
  referenceParam: 'imageUrls' as const,
};
const SOURCE = {
  fileId: 'file_5EPW42StH4Bd',
  name: 'scene.png',
  parentId: 'docs_folder',
  url: 'https://app.lobehub.com/f/file_5EPW42StH4Bd',
};

const spyDeps = (overrides = {}) => {
  const base = createMockDeps(overrides);
  return Object.fromEntries(
    Object.entries(base).map(([key, fn]) => [key, vi.fn(fn as any)]),
  ) as unknown as { [K in keyof typeof base]: ReturnType<typeof vi.fn> } & typeof base;
};

/** No call may write to, move, or delete the source file. */
const expectSourceUntouched = (deps: ReturnType<typeof spyDeps>) => {
  for (const call of deps.updateFile.mock.calls) expect(call[0]).not.toBe(SOURCE.fileId);
  for (const call of deps.removeFile.mock.calls) expect(call[0]).not.toBe(SOURCE.fileId);
  for (const call of deps.uploadFile.mock.calls) expect(call[0].file.name).not.toBe(SOURCE.name);
};

const run = (deps: ReturnType<typeof spyDeps>, extra: Record<string, unknown> = {}) =>
  runAIImageEdit({
    deps,
    model: MODEL,
    operation: 'removeBackground',
    pollInterval: 1,
    source: SOURCE,
    topicTitle: 'Remove background · scene.png',
    ...extra,
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runAIImageEdit', () => {
  it('submits the original image to the generation pipeline with the remove-background prompt', async () => {
    const deps = spyDeps();
    await run(deps);

    expect(deps.createTopic).toHaveBeenCalledWith('Remove background · scene.png');
    expect(deps.createImage).toHaveBeenCalledWith({
      generationTopicId: 'gt_6p9nBZERtyWe',
      imageNum: 1,
      model: 'gemini-3.1-flash-image:image',
      params: { imageUrls: [SOURCE.url], prompt: AI_EDIT_PROMPTS.removeBackground },
      provider: 'lobehub',
    });
    expect(deps.getStatus).toHaveBeenCalledWith(
      'gen_IUVYApnU4NYX',
      '0f070379-d3ef-4038-9cfb-c88764b63399',
    );
    // Remove background reads the stored file directly: nothing is uploaded.
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });

  it('saves the result as a new file next to the original and never touches the original', async () => {
    const deps = spyDeps();
    const phases: string[] = [];
    const result = await run(deps, { onPhase: (phase: string) => phases.push(phase) });

    expect(result).toEqual({
      fileId: 'file_KWGzzbWzaunM',
      height: 843,
      name: 'scene-no-bg.png',
      url: 'https://app.lobehub.com/f/file_KWGzzbWzaunM',
      width: 1264,
    });
    expect(result.fileId).not.toBe(SOURCE.fileId);
    expect(deps.updateFile).toHaveBeenCalledTimes(1);
    expect(deps.updateFile).toHaveBeenCalledWith('file_KWGzzbWzaunM', {
      metadata: {
        ...realResultFileMetadata,
        derivedFrom: { fileId: SOURCE.fileId, operation: 'removeBackground' },
      },
      name: 'scene-no-bg.png',
      parentId: 'docs_folder',
    });
    expect(deps.deleteTopic).not.toHaveBeenCalled();
    expect(phases).toEqual(['generating', 'saving']);
    expectSourceUntouched(deps);
  });

  it('files the result in the original folder even when the viewer does not know it', async () => {
    const deps = spyDeps();
    await run(deps, { source: { ...SOURCE, parentId: undefined } });

    expect(deps.getFile).toHaveBeenCalledWith(SOURCE.fileId);
    expect(deps.updateFile.mock.calls[0][1].parentId).toBe('docs_folder');
    expectSourceUntouched(deps);
  });

  it('adds the result to the library the original is filed in', async () => {
    const deps = spyDeps({
      getFile: async (id: string) =>
        id === SOURCE.fileId
          ? { knowledgeBaseIds: ['kb_photos'], metadata: {}, parentId: 'docs_folder' }
          : { metadata: realResultFileMetadata, parentId: null },
    });
    await run(deps);

    expect(deps.addToKnowledgeBase).toHaveBeenCalledWith('kb_photos', ['file_KWGzzbWzaunM']);
    expect(deps.addToKnowledgeBase).toHaveBeenCalledTimes(1);
  });

  it('does not touch libraries when the original is in none', async () => {
    const deps = spyDeps();
    await run(deps);
    expect(deps.addToKnowledgeBase).not.toHaveBeenCalled();
  });

  it('polls until the task finishes', async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce(realProcessingStatus)
      .mockResolvedValueOnce(realProcessingStatus)
      .mockResolvedValueOnce(realSuccessStatus);
    const deps = spyDeps({ getStatus });
    await run(deps);
    expect(getStatus).toHaveBeenCalledTimes(3);
  });

  it('erase uploads the painted guide, edits it, and cleans the guide up', async () => {
    const deps = spyDeps();
    const guide = new Blob(['png'], { type: 'image/png' });
    const phases: string[] = [];
    const result = await run(deps, {
      guide,
      onPhase: (phase: string) => phases.push(phase),
      operation: 'erase',
      topicTitle: 'Erase · scene.png',
    });

    const uploaded = deps.uploadFile.mock.calls[0][0];
    expect(uploaded.file.name).toBe('scene-erase-guide.png');
    expect(uploaded.file.type).toBe('image/png');
    expect(deps.createImage.mock.calls[0][0].params).toEqual({
      imageUrls: ['https://app.lobehub.com/f/file_guide'],
      prompt: AI_EDIT_PROMPTS.erase,
    });
    expect(deps.removeFile).toHaveBeenCalledWith('file_guide');
    expect(result.name).toBe('scene-erased.png');
    expect(deps.updateFile.mock.calls[0][1].metadata.derivedFrom).toEqual({
      fileId: SOURCE.fileId,
      operation: 'erase',
    });
    expect(phases).toEqual(['uploading', 'generating', 'saving']);
    expectSourceUntouched(deps);
  });

  it('fails with the task error, discards the topic and saves nothing', async () => {
    const deps = spyDeps({ getStatus: async () => errorStatus });
    const error = await run(deps, { guide: new Blob(['x']), operation: 'erase' }).catch((e) => e);

    expect(error).toBeInstanceOf(AIImageEditError);
    expect(error.kind).toBe('failed');
    expect(error.message).toBe('Content blocked by the provider safety filter');
    expect(deps.deleteTopic).toHaveBeenCalledWith('gt_6p9nBZERtyWe');
    expect(deps.removeFile).toHaveBeenCalledWith('file_guide');
    expect(deps.updateFile).not.toHaveBeenCalled();
    expectSourceUntouched(deps);
  });

  it('reports a request that is rejected up front', async () => {
    const deps = spyDeps({
      createImage: async () => {
        throw new Error('Insufficient budget');
      },
    });
    await expect(run(deps)).rejects.toMatchObject({
      kind: 'failed',
      message: 'Insufficient budget',
    });
    expect(deps.deleteTopic).toHaveBeenCalledWith('gt_6p9nBZERtyWe');
  });

  it('treats a batch without a task as a failure', async () => {
    const deps = spyDeps({
      createImage: async () => ({ ...realCreateImageResult, data: { generations: [] } }),
    });
    await expect(run(deps)).rejects.toMatchObject({ kind: 'failed' });
  });

  it('reports success without an asset as no result', async () => {
    const deps = spyDeps({
      getStatus: async () => ({
        ...realSuccessStatus,
        generation: { ...realSuccessStatus.generation, asset: null },
      }),
    });
    await expect(run(deps)).rejects.toMatchObject({ kind: 'noResult' });
    expect(deps.updateFile).not.toHaveBeenCalled();
  });

  it('cancels while generating: stops polling, deletes the topic, saves nothing', async () => {
    const controller = new AbortController();
    const getStatus = vi.fn(async () => {
      controller.abort();
      return realProcessingStatus;
    });
    const deps = spyDeps({ getStatus });

    const error = await run(deps, { pollInterval: 5, signal: controller.signal }).catch((e) => e);

    expect(error).toBeInstanceOf(AIImageEditError);
    expect(error.kind).toBe('cancelled');
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(deps.deleteTopic).toHaveBeenCalledWith('gt_6p9nBZERtyWe');
    expect(deps.updateFile).not.toHaveBeenCalled();
    expectSourceUntouched(deps);
  });

  it('discards a result that arrives after cancel', async () => {
    const controller = new AbortController();
    const deps = spyDeps({
      getStatus: async () => {
        controller.abort();
        return realSuccessStatus;
      },
    });
    await expect(run(deps, { signal: controller.signal })).rejects.toMatchObject({
      kind: 'cancelled',
    });
    expect(deps.updateFile).not.toHaveBeenCalled();
    expect(deps.deleteTopic).toHaveBeenCalled();
  });

  it('times out a task that never finishes', async () => {
    const deps = spyDeps({ getStatus: async () => realProcessingStatus });
    await expect(run(deps, { timeout: 5 })).rejects.toMatchObject({ kind: 'timeout' });
    expect(deps.deleteTopic).toHaveBeenCalled();
  });

  it('copies the asset into a new file when the server does not report the file', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { status: 200 }));
    const deps = spyDeps({
      getStatus: async () => ({
        ...realSuccessStatus,
        generation: { ...realSuccessStatus.generation, fileId: undefined },
      }),
      uploadFile: async () => ({ id: 'file_copy', url: 'https://app.lobehub.com/f/file_copy' }),
    });

    const result = await run(deps);

    expect(globalThis.fetch).toHaveBeenCalledWith('https://app.lobehub.com/f/file_KWGzzbWzaunM');
    const uploaded = deps.uploadFile.mock.calls[0][0];
    expect(uploaded.file.name).toBe('scene-no-bg.png');
    expect(uploaded.parentId).toBe('docs_folder');
    expect(uploaded.metadata).toEqual({
      derivedFrom: { fileId: SOURCE.fileId, operation: 'removeBackground' },
    });
    expect(result.fileId).toBe('file_copy');
    expect(deps.updateFile).not.toHaveBeenCalled();
    expectSourceUntouched(deps);
  });

  it('never lets cleanup failures mask the outcome', async () => {
    const deps = spyDeps({
      deleteTopic: async () => {
        throw new Error('network');
      },
      getStatus: async () => errorStatus,
    });
    await expect(run(deps)).rejects.toMatchObject({ kind: 'failed' });
  });
});
