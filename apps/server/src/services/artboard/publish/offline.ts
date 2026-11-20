import { unpublishCanvasSite } from '@/business/server/canvasPublish';
import type { ArtboardWork } from '@/database/models/work/artboard';
import type { LobeChatDatabase } from '@/database/type';

export interface ArtboardShareOwner {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

// The deployment lives with whoever published it, not with the Work's current owner.
export const unpublishArtboardWork = async (owner: ArtboardShareOwner, work: ArtboardWork) => {
  const publish = work.metadata?.artboardPublish;
  if (!publish) return;
  await unpublishCanvasSite({
    ...owner,
    deploymentId: publish.deploymentId,
    userId: publish.publisherUserId,
  });
};
