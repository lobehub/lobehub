import type { CollectionModalParams } from '.';

/** Load the collection viewer on first open, so cards do not bundle the image viewer. */
export const openCollectionModal = async (params: CollectionModalParams) => {
  const { createCollectionModal } = await import('.');
  return createCollectionModal(params);
};
