import { isArtboardEnabled } from '../useArtboardFeature';

export const openArtboardFullscreen = async (artboardId: string) => {
  if (!isArtboardEnabled()) return;
  const { createArtboardGalleryModal } = await import('.');
  if (!isArtboardEnabled()) return;
  return createArtboardGalleryModal(artboardId);
};
