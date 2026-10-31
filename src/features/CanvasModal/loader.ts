export const openCanvasModal = async (canvasId: string, version?: number, page?: string) => {
  const { createCanvasModal } = await import('.');
  return createCanvasModal(canvasId, version, page);
};
