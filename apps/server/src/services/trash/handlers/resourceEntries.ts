import type { DocumentItem, FileItem, KnowledgeBaseItem } from '@/database/schemas';

export const documentEntry = (
  document: Pick<
    DocumentItem,
    | 'fileType'
    | 'filename'
    | 'id'
    | 'knowledgeBaseId'
    | 'parentId'
    | 'title'
    | 'userId'
    | 'visibility'
  >,
) => ({
  meta: {
    creatorUserId: document.userId,
    kind: document.fileType,
    knowledgeBaseId: document.knowledgeBaseId,
    parentId: document.parentId,
    visibility: document.visibility,
  },
  resourceId: document.id,
  resourceType: 'document' as const,
  title: document.title || document.filename,
});

export const fileEntry = (
  file: Pick<FileItem, 'fileType' | 'id' | 'name' | 'parentId' | 'size' | 'userId' | 'visibility'>,
) => ({
  meta: {
    creatorUserId: file.userId,
    kind: file.fileType,
    parentId: file.parentId,
    size: file.size,
    visibility: file.visibility,
  },
  resourceId: file.id,
  resourceType: 'file' as const,
  title: file.name,
});

export const knowledgeBaseEntry = (
  knowledgeBase: Pick<KnowledgeBaseItem, 'avatar' | 'id' | 'name' | 'userId' | 'visibility'>,
) => ({
  meta: {
    avatar: knowledgeBase.avatar,
    creatorUserId: knowledgeBase.userId,
    visibility: knowledgeBase.visibility,
  },
  resourceId: knowledgeBase.id,
  resourceType: 'knowledgeBase' as const,
  title: knowledgeBase.name,
});
