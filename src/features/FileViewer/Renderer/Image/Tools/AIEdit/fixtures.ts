import type { AIEditDeps } from './runAIImageEdit';

/**
 * Shapes captured from one real `image.createImage` → `generation.getGenerationStatus`
 * round trip (lobehub / gemini-3.1-flash-image:image, remove background). Tests and
 * acceptance replay these instead of calling the model again.
 */
export const realCreateImageResult = {
  data: {
    batch: {
      config: {
        imageUrls: [
          'files/2026-10-05/34168abd994ba81ca274d39535fb3561608764ff5fb707a7814e734139c0870d.png',
        ],
        prompt: 'Remove the background of this image.',
      },
      generationTopicId: 'gt_6p9nBZERtyWe',
      height: null,
      id: 'gb_L80eFud827rr',
      model: 'gemini-3.1-flash-image:image',
      provider: 'lobehub',
      width: null,
    },
    generations: [
      {
        asset: null,
        asyncTaskId: '0f070379-d3ef-4038-9cfb-c88764b63399',
        fileId: null,
        generationBatchId: 'gb_L80eFud827rr',
        id: 'gen_IUVYApnU4NYX',
        seed: null,
      },
    ],
  },
  success: true,
};

export const realProcessingStatus = { error: null, generation: null, status: 'processing' };

export const realSuccessStatus = {
  error: null,
  generation: {
    asset: {
      height: 843,
      originalUrl: 'generations/images/EUNmLlU476d4SS8D9eTsY_1264x843_20261004_165918_raw.png',
      thumbnailUrl:
        'https://storage.example.com/generations/images/EUNmLlU476d4SS8D9eTsY_512x341_20261004_165918_thumb.webp',
      type: 'image',
      url: 'https://app.lobehub.com/f/file_KWGzzbWzaunM',
      width: 1264,
    },
    asyncTaskId: '0f070379-d3ef-4038-9cfb-c88764b63399',
    createdAt: new Date('2026-10-04T16:59:07.945Z'),
    // Reported once the server exposes the generation's file (this change).
    fileId: 'file_KWGzzbWzaunM',
    id: 'gen_IUVYApnU4NYX',
    seed: null,
    task: { id: '0f070379-d3ef-4038-9cfb-c88764b63399', status: 'success' },
  },
  status: 'success',
};

/** Metadata the generation pipeline stores on the result file. */
export const realResultFileMetadata = {
  generationId: 'gen_IUVYApnU4NYX',
  height: 843,
  path: 'generations/images/EUNmLlU476d4SS8D9eTsY_1264x843_20261004_165918_raw.png',
  width: 1264,
};

/** Failure shape follows `AsyncTaskError` (`{ name, body: { detail } }`); not captured live. */
export const errorStatus = {
  error: { body: { detail: 'Content blocked by the provider safety filter' }, name: 'ServerError' },
  generation: null,
  status: 'error',
};

export const createMockDeps = (overrides: Partial<AIEditDeps> = {}) => {
  const deps = {
    addToKnowledgeBase: async () => undefined,
    createImage: async () => realCreateImageResult,
    createTopic: async () => 'gt_6p9nBZERtyWe',
    deleteTopic: async () => undefined,
    getFile: async (id: string) =>
      id === 'file_KWGzzbWzaunM'
        ? { metadata: realResultFileMetadata, parentId: null }
        : { knowledgeBaseIds: [], metadata: {}, parentId: 'docs_folder' },
    getStatus: async () => realSuccessStatus,
    removeFile: async () => undefined,
    updateFile: async () => ({ success: true }),
    uploadFile: async () => ({ id: 'file_guide', url: 'https://app.lobehub.com/f/file_guide' }),
    ...overrides,
  } as AIEditDeps;
  return deps;
};
