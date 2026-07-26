const importDocumentModal = () => import('.');

let documentModalPromise: ReturnType<typeof importDocumentModal> | undefined;

export const preloadDocumentModal = (): ReturnType<typeof importDocumentModal> =>
  (documentModalPromise ??= importDocumentModal());
