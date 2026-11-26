import type { KnowledgeBaseItem } from '@lobechat/types';

import type { FavoriteTarget } from '@/features/Favorites';

/** A knowledge base's entry in the sidebar Favorites. */
export const libraryFavoriteTarget = (
  library: Pick<KnowledgeBaseItem, 'id' | 'name'> & { avatar?: string | null },
): FavoriteTarget => ({
  icon: library.avatar || null,
  // The library root, not the folder or file open below it.
  path: `/resource/library/${library.id}`,
  targetId: library.id,
  title: library.name,
  type: 'library',
});
