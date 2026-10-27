export const openCanvasModal = async (canvasId: string, version?: number) => {
  const { createCanvasModal } = await import('.');
  return createCanvasModal(canvasId, version);
};
