import debug from 'debug';

import { lambdaClient } from '@/libs/trpc/client';
import { type CreateImageServicePayload } from '@/server/routers/lambda/image';

// Create debug logger
const log = debug('lobe-image:service');

export class AiImageService {
  async createImage(payload: CreateImageServicePayload) {
    log('Creating image with payload: %O', payload);

    try {
      const result = await lambdaClient.image.createImage.mutate(payload);
      log('Image creation service call completed successfully: %O', {
        batchId: result.data?.batch?.id,
        generationCount: result.data?.generations?.length,
        success: result.success,
      });

      return result;
    } catch (error) {
      log('Image creation service call failed: %O', {
        error: (error as Error).message,
        payload,
      });

      throw error;
    }
  }
}

export const imageService = new AiImageService();
