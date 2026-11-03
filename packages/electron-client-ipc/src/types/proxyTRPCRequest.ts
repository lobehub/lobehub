export interface StreamInvokeRequestParams {
  body?: string | ArrayBuffer;
  headers: Record<string, string>;
  method: string;
  /**
   * Optional client-generated request id.
   *
   * In desktop, the preload layer will generate and override its own `requestId`
   * when forwarding to the main process, so this is optional at the API boundary.
   */
  requestId?: string;
  urlPath: string;
}

export interface ProxyTRPCStreamRequestParams extends StreamInvokeRequestParams {
  requestId: string;
}
