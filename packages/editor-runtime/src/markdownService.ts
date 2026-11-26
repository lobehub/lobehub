// @lobehub/editor's IMarkdownShortCutService. Kernels look services up by this
// name; the constant itself lives in the package's main entry, which pulls in
// React and so cannot be imported by modules the server loads.
export const MARKDOWN_SERVICE_ID = { __serviceId: 'MarkdownShortCutService' };

/** The part of an @lobehub/editor kernel a document plugin needs. */
export interface ServiceKernel {
  requireService: (serviceId: { __serviceId: string }) => unknown;
}
