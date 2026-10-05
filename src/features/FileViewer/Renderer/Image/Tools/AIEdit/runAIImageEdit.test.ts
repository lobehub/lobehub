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

    expect(deps.createTopic).toHaveBeenCalledWith('Remove background · scene.png', undefined);
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
      libraryFailed: false,
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

  it('reports a failed library link without failing the saved edit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = spyDeps({
      addToKnowledgeBase: async () => {
        throw new Error('forbidden');
      },
      getFile: async (id: string) =>
        id === SOURCE.fileId
          ? { knowledgeBaseIds: ['kb_1'], parentId: 'docs_folder' }
          : { metadata: realResultFileMetadata, parentId: null },
    });

    const result = await run(deps);

    expect(result.libraryFailed).toBe(true);
    expect(result.fileId).toBe('file_KWGzzbWzaunM');
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

  it('fails with the task error, keeps its record and saves nothing', async () => {
    const deps = spyDeps({ getStatus: async () => errorStatus });
    const error = await run(deps, { guide: new Blob(['x']), operation: 'erase' }).catch((e) => e);

    expect(error).toBeInstanceOf(AIImageEditError);
    expect(error.kind).toBe('failed');
    expect(error.message).toBe('Content blocked by the provider safety filter');
    // The failed generation stays under Image generation, like any other run.
    expect(deps.deleteTopic).not.toHaveBeenCalled();
    expect(deps.removeFile).toHaveBeenCalledWith('file_guide');
    expect(deps.updateFile).not.toHaveBeenCalled();
    expectSourceUntouched(deps);
  });

  it('reports a request that is rejected up front', async () => {
    const deps = spyDeps({
      createImage: async () => {
        // Shape of a TRPCClientError for a 4xx answer.
        throw Object.assign(new Error('Insufficient budget'), { data: { httpStatus: 403 } });
      },
    });
    await expect(run(deps)).rejects.toMatchObject({
      kind: 'failed',
      message: 'Insufficient budget',
      taskRunning: false,
    });
    expect(deps.deleteTopic).toHaveBeenCalledWith('gt_6p9nBZERtyWe');
  });

  // Regression: the server starts the task before answering, so a lost
  // response must not delete the topic and input of a job that may be running.
  it('keeps the topic and guide when the create response is lost', async () => {
    const deps = spyDeps({
      createImage: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(
      run(deps, { guide: new Blob(['png'], { type: 'image/png' }), operation: 'erase' }),
    ).rejects.toMatchObject({ kind: 'failed', taskRunning: true });
    expect(deps.deleteTopic).not.toHaveBeenCalled();
    expect(deps.removeFile).not.toHaveBeenCalled();
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

  it('cancels while generating: stops waiting but keeps the running task and its topic', async () => {
    const controller = new AbortController();
    const getStatus = vi.fn(async () => {
      controller.abort();
      return realProcessingStatus;
    });
    const deps = spyDeps({ getStatus });

    const error = await run(deps, { pollInterval: 5, signal: controller.signal }).catch((e) => e);

    expect(error).toBeInstanceOf(AIImageEditError);
    expect(error.kind).toBe('cancelled');
    expect(error.taskRunning).toBe(true);
    expect(getStatus).toHaveBeenCalledTimes(1);
    // The server task cannot be aborted; deleting its topic would orphan its result.
    expect(deps.deleteTopic).not.toHaveBeenCalled();
    expect(deps.updateFile).not.toHaveBeenCalled();
    expectSourceUntouched(deps);
  });

  it('keeps the erase guide for a task that is still running', async () => {
    const controller = new AbortController();
    const deps = spyDeps({
      getStatus: async () => {
        controller.abort();
        return realProcessingStatus;
      },
    });

    await expect(
      run(deps, {
        guide: new Blob(['png'], { type: 'image/png' }),
        operation: 'erase',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: 'cancelled', taskRunning: true });
    expect(deps.removeFile).not.toHaveBeenCalled();
    expect(deps.deleteTopic).not.toHaveBeenCalled();
  });

  // Regression: nothing removed the guide of an abandoned task once it settled.
  it('removes the erase guide once an abandoned task settles', async () => {
    const controller = new AbortController();
    let polls = 0;
    const deps = spyDeps({
      getStatus: async () => {
        polls += 1;
        if (polls === 1) {
          controller.abort();
          return realProcessingStatus;
        }
        return polls < 3 ? realProcessingStatus : realSuccessStatus;
      },
    });

    await expect(
      run(deps, {
        guide: new Blob(['png'], { type: 'image/png' }),
        operation: 'erase',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: 'cancelled', taskRunning: true });
    expect(deps.removeFile).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(deps.removeFile).toHaveBeenCalledWith('file_guide'));
    // The result itself is left in the generation topic.
    expect(deps.deleteTopic).not.toHaveBeenCalled();
    expect(deps.updateFile).not.toHaveBeenCalled();
  });

  it('cleans up the topic when cancelled before the task is submitted', async () => {
    const controller = new AbortController();
    const deps = spyDeps({
      createTopic: async () => {
        controller.abort();
        return 'gt_6p9nBZERtyWe';
      },
    });

    await expect(run(deps, { signal: controller.signal })).rejects.toMatchObject({
      kind: 'cancelled',
      taskRunning: false,
    });
    expect(deps.createImage).not.toHaveBeenCalled();
    expect(deps.deleteTopic).toHaveBeenCalledWith('gt_6p9nBZERtyWe');
  });

  // Regression: deleting the topic of a finished run removed the stored asset
  // while its file row survived, leaving a file without bytes.
  it('leaves a result that arrives after cancel in its generation topic', async () => {
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
    expect(deps.deleteTopic).not.toHaveBeenCalled();
  });

  it('keeps a finished result when saving it beside the original fails', async () => {
    const deps = spyDeps({
      updateFile: async () => {
        throw new Error('network');
      },
    });
    await expect(run(deps)).rejects.toMatchObject({ kind: 'failed' });
    expect(deps.deleteTopic).not.toHaveBeenCalled();
  });

  it('prefers the folder reported by the server over a stale client one', async () => {
    const deps = spyDeps();
    await run(deps, { source: { ...SOURCE, parentId: 'docs_stale' } });

    expect(deps.updateFile.mock.calls[0][1].parentId).toBe('docs_folder');
  });

  it('treats a failed status request as a task that may still be running', async () => {
    const deps = spyDeps({
      getStatus: async () => {
        throw new Error('fetch failed');
      },
    });

    await expect(run(deps)).rejects.toMatchObject({ kind: 'failed', taskRunning: true });
    expect(deps.deleteTopic).not.toHaveBeenCalled();
  });

  it('gives the generation topic the original file visibility', async () => {
    const deps = spyDeps({
      getFile: async (id: string) =>
        id === SOURCE.fileId
          ? { knowledgeBaseIds: [], parentId: 'docs_folder', visibility: 'public' as const }
          : { metadata: realResultFileMetadata, parentId: null },
    });

    await run(deps);

    expect(deps.createTopic).toHaveBeenCalledWith('Remove background · scene.png', 'public');
  });

  it('does not submit anything when cancelled before starting', async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = spyDeps();

    await expect(run(deps, { signal: controller.signal })).rejects.toMatchObject({
      kind: 'cancelled',
      taskRunning: false,
    });
    expect(deps.createTopic).not.toHaveBeenCalled();
    expect(deps.createImage).not.toHaveBeenCalled();
  });

  // Regression: a hung status request kept the tool locked past cancel and the deadline.
  it('cancels while a status request hangs', async () => {
    const controller = new AbortController();
    const deps = spyDeps({ getStatus: () => new Promise<never>(() => {}) });

    const pending = run(deps, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    await expect(pending).rejects.toMatchObject({ kind: 'cancelled', taskRunning: true });
  });

  // Regression: a stalled create call ignored Cancel and the deadline.
  it('cancels while the create call hangs, treating the task as possibly started', async () => {
    const controller = new AbortController();
    const deps = spyDeps({ createImage: () => new Promise<never>(() => {}) });

    const pending = run(deps, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    await expect(pending).rejects.toMatchObject({ kind: 'cancelled', taskRunning: true });
    expect(deps.deleteTopic).not.toHaveBeenCalled();
  });

  // Regression: a failing status endpoint was polled every interval for the
  // whole watch window.
  it('backs off the guide-cleanup watch while status requests fail', async () => {
    const controller = new AbortController();
    let calls = 0;
    const deps = spyDeps({
      getStatus: async () => {
        calls += 1;
        if (calls === 1) {
          controller.abort();
          return realProcessingStatus;
        }
        throw new Error('outage');
      },
    });

    await run(deps, {
      guide: new Blob(['png'], { type: 'image/png' }),
      operation: 'erase',
      pollInterval: 2,
      settleWatch: 200,
      signal: controller.signal,
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Doubling from 2ms within 200ms allows about 7 tries, not ~100.
    expect(calls).toBeLessThan(12);
    expect(deps.removeFile).not.toHaveBeenCalled();
  });

  it('times out while a status request hangs', async () => {
    const deps = spyDeps({ getStatus: () => new Promise<never>(() => {}) });

    await expect(run(deps, { timeout: 20 })).rejects.toMatchObject({
      kind: 'timeout',
      taskRunning: true,
    });
  });

  it('stops waiting at the timeout and leaves the running task alone', async () => {
    const deps = spyDeps({ getStatus: async () => realProcessingStatus });
    await expect(run(deps, { timeout: 5 })).rejects.toMatchObject({
      kind: 'timeout',
      taskRunning: true,
    });
    expect(deps.deleteTopic).not.toHaveBeenCalled();
  });

  // Regression: an older server omits `fileId`, but the `/f/:id` asset URL
  // still names the file. Fetching the proxy would fail CORS on its redirect.
  it('uses the file behind a proxy asset URL when the server does not report the file', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const deps = spyDeps({
      getStatus: async () => ({
        ...realSuccessStatus,
        generation: { ...realSuccessStatus.generation, fileId: undefined },
      }),
    });

    const result = await run(deps);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.updateFile.mock.calls[0][0]).toBe('file_KWGzzbWzaunM');
    expect(result.fileId).toBe('file_KWGzzbWzaunM');
  });

  it('copies the asset into a new file when the server does not report the file', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(blob, { status: 200 }));
    const deps = spyDeps({
      getStatus: async () => ({
        ...realSuccessStatus,
        generation: {
          ...realSuccessStatus.generation,
          asset: {
            ...realSuccessStatus.generation.asset,
            url: 'https://s3.example.com/result.png',
          },
          fileId: undefined,
        },
      }),
      uploadFile: async () => ({ id: 'file_copy', url: 'https://app.lobehub.com/f/file_copy' }),
    });

    const result = await run(deps);

    expect(globalThis.fetch).toHaveBeenCalledWith('https://s3.example.com/result.png');
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
      createImage: async () => {
        throw Object.assign(new Error('Bad request'), { data: { httpStatus: 400 } });
      },
      deleteTopic: async () => {
        throw new Error('network');
      },
    });
    await expect(run(deps)).rejects.toMatchObject({ kind: 'failed' });
  });
});
