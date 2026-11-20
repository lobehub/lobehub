import { getServerDB } from '@/database/server';
import { serveArtboardFile } from '@/server/services/artboard/fileAccess';
import { createFileServiceArtboardBlobStore } from '@/server/services/artboard/files';
import { FileService } from '@/server/services/file';

type Params = Promise<{ path: string[]; token: string }>;

export const GET = async (_request: Request, segmentData: { params: Params }) => {
  const { path, token } = await segmentData.params;
  const db = await getServerDB();
  return serveArtboardFile({
    db,
    path: path.join('/'),
    storeFor: ({ userId, workspaceId }) =>
      createFileServiceArtboardBlobStore(
        () => new FileService(db, userId, workspaceId ?? undefined),
      ),
    token,
  });
};
