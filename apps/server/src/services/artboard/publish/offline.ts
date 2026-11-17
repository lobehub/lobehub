import { unpublishCanvasSite } from '@/business/server/canvasPublish';
import type { ArtboardWork } from '@/database/models/work/artboard';
import type { LobeChatDatabase } from '@/database/type';

export interface ArtboardShareOwner {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

export const unpublishArtboardWork = async (owner: ArtboardShareOwner, work: ArtboardWork) => {
  const deploymentId = work.metadata?.artboardPublish?.deploymentId;
  if (deploymentId) await unpublishCanvasSite({ ...owner, deploymentId });
};
