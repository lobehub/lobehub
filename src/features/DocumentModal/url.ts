import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

export const buildDocumentModalUrl = (
  appOrigin: string,
  documentId: string,
  activeWorkspaceSlug?: string | null,
) => {
  const path = buildWorkspaceAwarePath(`/page/${documentId}`, activeWorkspaceSlug);
  return `${appOrigin}${path}`;
};
