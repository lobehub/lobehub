import type { LobeChatDatabase } from '@lobechat/database';
import type { CanvasPublishBundle } from '@lobechat/types';

export interface PublishCanvasSiteParams {
  bundle: CanvasPublishBundle;
  canvasId: string;
  db: LobeChatDatabase;
  deploymentId?: string;
  title: string;
  userId: string;
  workspaceId?: string;
}

export interface PublishCanvasSiteResult {
  deploymentId: string;
  url: string;
}

export const isCanvasPublishEnabled = () => false;

export const getCanvasPublishRuntimeUrl = async (_major: number): Promise<string | undefined> =>
  undefined;

export const publishCanvasSite = async (
  _params: PublishCanvasSiteParams,
): Promise<PublishCanvasSiteResult> => {
  throw new Error('Canvas publishing is not available in this deployment');
};
