'use client';

import { memo } from 'react';

import { FavoriteButton } from '@/features/Favorites';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';

import { libraryFavoriteTarget } from '../../libraryFavorite';

/**
 * Header star for the open library. It waits for the library's own name, so a
 * placeholder title is never saved, and while mounted it keeps a renamed
 * library's favorite title current.
 */
const LibraryFavoriteButton = memo<{ id: string }>(({ id }) => {
  const library = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseById(id));

  if (!library?.name) return null;

  return <FavoriteButton {...libraryFavoriteTarget(library)} />;
});

LibraryFavoriteButton.displayName = 'LibraryFavoriteButton';

export default LibraryFavoriteButton;
