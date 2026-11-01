const importDocumentModal = () => import('.');

let documentModalPromise: ReturnType<typeof importDocumentModal> | undefined;

export const preloadDocumentModal = (): ReturnType<typeof importDocumentModal> =>
  (documentModalPromise ??= importDocumentModal().catch((error) => {
    documentModalPromise = undefined;
    throw error;
  }));

export const openDocumentModal = async (documentId: string) => {
  const { createDocumentModal } = await preloadDocumentModal();

  return createDocumentModal(documentId);
};
