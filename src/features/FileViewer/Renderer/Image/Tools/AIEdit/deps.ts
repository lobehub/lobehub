import { lambdaClient } from '@/libs/trpc/client';
import { cutOutFlatBackground } from '@/services/artworkGeneration/cutOutFlatBackground';
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
  cutOutBackground: async (url, name) => {
    const img = await loadStageImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Same framing as the original, so no crop to the subject here.
    if (!cutOutFlatBackground(pixels).applied) return;
    ctx.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? new File([blob], name, { type: 'image/png' }) : undefined;
  },
  deleteTopic: (id) => generationTopicService.deleteTopic(id),
  getFile: async (id) => {
    const file = await lambdaClient.file.findById.query({ id });
    return {
      knowledgeBaseIds: file.knowledgeBaseIds,
      metadata: file.metadata as Record<string, unknown> | null,
      parentId: file.parentId,
      size: file.size,
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
