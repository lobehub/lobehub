const importPDFRenderer = () => import('.');

let pdfRendererPromise: ReturnType<typeof importPDFRenderer> | undefined;

export const preloadPDFRenderer = (): ReturnType<typeof importPDFRenderer> =>
  (pdfRendererPromise ??= importPDFRenderer());
