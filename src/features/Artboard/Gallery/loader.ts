export const openArtboardFullscreen = async (artboardId: string) => {
  const { createArtboardGalleryModal } = await import('.');
  return createArtboardGalleryModal(artboardId);
};
