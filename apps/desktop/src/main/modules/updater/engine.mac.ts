import type { UpdateChannel } from '@lobechat/electron-client-ipc';
import { app } from 'electron';

import { getSparkleFeedUrl, UPDATE_SERVER_URL } from './configs';
import type { UpdateEngine } from './engine';
import { SparkleEngine } from './sparkleEngine';

export const createUpdateEngine = async (channel: UpdateChannel): Promise<UpdateEngine> => {
  if (!UPDATE_SERVER_URL) throw new Error('Sparkle requires UPDATE_SERVER_URL');
  return SparkleEngine.create({
    appcastUrl: getSparkleFeedUrl(UPDATE_SERVER_URL, channel),
    currentVersion: app.getVersion(),
  });
};
