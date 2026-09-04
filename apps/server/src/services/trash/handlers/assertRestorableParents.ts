import type { DocumentModel } from '@/database/models/document';

import { TrashRestoreError } from './types';

interface RestoredResource {
  parentId?: string | null;
}

export const assertRestorableParents = async (
  documentModel: DocumentModel,
  resources: RestoredResource[],
  restoringDocumentIds: string[],
) => {
  const restoredDocuments = new Set(restoringDocumentIds);
  const externalParentIds = [
    ...new Set(
      resources
        .map((resource) => resource.parentId)
        .filter(
          (parentId): parentId is string =>
            typeof parentId === 'string' && !restoredDocuments.has(parentId),
        ),
    ),
  ];

  if (await documentModel.hasUnrestorableParents(externalParentIds)) {
    throw new TrashRestoreError('parentTrashed');
  }
};
