import type { DocumentRecord } from '@lobechat/builtin-tool-personal-pages';

import type { PersonalPageSnapshot } from '@/server/services/personalPages';

export const toDocumentRecord = (
  snapshot: PersonalPageSnapshot | undefined,
): DocumentRecord | undefined => {
  if (!snapshot) return undefined;

  return {
    content: snapshot.content,
    id: snapshot.id,
    litexml: snapshot.litexml,
    title: snapshot.title ?? undefined,
  };
};
