import { lambdaClient } from '@/libs/trpc/client';
import { fileService } from '@/services/file';
import { generationService } from '@/services/generation';
import { generationTopicService } from '@/services/generationTopic';
import { imageService } from '@/services/image';
import { knowledgeBaseService } from '@/services/knowledgeBase';
import { useFileStore } from '@/store/file';

import { loadReadableImage } from '../exportImage';
import type { AIEditDeps } from './runAIImageEdit';

/** The real pipeline: the same image generation services the image page uses. */
export const aiEditDeps: AIEditDeps = {
  addToKnowledgeBase: (knowledgeBaseId, fileIds) =>
    knowledgeBaseService.addFilesToKnowledgeBase(knowledgeBaseId, fileIds),
  createImage: (payload) => imageService.createImage(payload),
  createTopic: (title, visibility) =>
    generationTopicService.createTopic('image', visibility, title),
  deleteTopic: (id) => generationTopicService.deleteTopic(id),
  getFile: async (id) => {
    const file = await lambdaClient.file.findById.query({ id });
    return {
      knowledgeBaseIds: file.knowledgeBaseIds,
      metadata: file.metadata as Record<string, unknown> | null,
      parentId: file.parentId,
      visibility: file.visibility,
    };
  },
  getStatus: (generationId, asyncTaskId) =>
    generationService.getGenerationStatus(generationId, asyncTaskId),
  removeFile: (id) => fileService.removeFile(id),
  updateFile: (id, data) => fileService.updateFile(id, data),
  uploadFile: async ({ file, metadata, parentId, visibility }) => {
    const result = await useFileStore.getState().uploadWithProgress({
      file,
      fileMetadata: metadata,
      parentId,
      visibility,
    });
    return result && { id: result.id, url: result.url };
  },
};

/** Load the image on stage for canvas export, reading `/f/:id` files from storage directly. */
export const loadStageImage = (url: string) =>
  loadReadableImage(url, { resolveProxyUrl: (id) => fileService.getReadableUrl(id) });
