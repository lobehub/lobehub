import { docsPagePath } from '@/features/ResourceHome/paths';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

export const buildDocumentModalUrl = (
  appOrigin: string,
  documentId: string,
  activeWorkspaceSlug?: string | null,
) => {
  const path = buildWorkspaceAwarePath(docsPagePath(documentId), activeWorkspaceSlug);
  return `${appOrigin}${path}`;
};
