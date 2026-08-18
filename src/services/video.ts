import debug from 'debug';

import { lambdaClient } from '@/libs/trpc/client';
import { type CreateVideoServicePayload } from '@/server/routers/lambda/video';

const log = debug('lobe-video:service');

export class AiVideoService {
  async createVideo(payload: CreateVideoServicePayload) {
    log('Creating video with payload: %O', payload);

    try {
      const { assertAicoBillingAllowsChat, refreshAicoBillingBalance } =
        await import('@/features/AicoBilling');
      const aicoBilling = await assertAicoBillingAllowsChat(payload.provider);
      const requestPayload = aicoBilling ? { ...payload, aicoBilling } : payload;

      const result = await lambdaClient.video.createVideo.mutate(requestPayload);
      log('Video creation service call completed: %O', {
        batchId: result.data?.batch?.id,
        generationCount: result.data?.generations?.length,
        success: result.success,
      });

      if (aicoBilling) {
        void refreshAicoBillingBalance();
      }

      return result;
    } catch (error) {
      log('Video creation service call failed: %O', {
        error: (error as Error).message,
        payload,
      });

      throw error;
    }
  }
}

export const videoService = new AiVideoService();
