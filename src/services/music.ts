import debug from 'debug';

import { lambdaClient } from '@/libs/trpc/client';
import { type CreateMusicServicePayload } from '@/server/routers/lambda/music';

const log = debug('lobe-music:service');

export class AiMusicService {
  async createMusic(payload: CreateMusicServicePayload) {
    log('Creating music with payload: %O', payload);

    try {
      const result = await lambdaClient.music.createMusic.mutate(payload);
      log('Music creation service call completed: %O', { success: result.success });

      return result;
    } catch (error) {
      log('Music creation service call failed: %O', { error: (error as Error).message });
      throw error;
    }
  }
}

export const musicService = new AiMusicService();
