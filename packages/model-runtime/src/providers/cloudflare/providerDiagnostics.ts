import { appendProviderResponseEvent } from '../../core/providerDiagnostics';
import type { ProviderResponseDiagnostics } from '../../types/providerDiagnostics';

export const recordCloudflareStreamChunk = (
  diagnostics: ProviderResponseDiagnostics,
  chunk: unknown,
) => {
  diagnostics.firstEventAt ??= Date.now();
  diagnostics.responseReceivedAt ??= Date.now();
  appendProviderResponseEvent(diagnostics, {
    contentLength:
      chunk instanceof Uint8Array
        ? chunk.byteLength
        : typeof chunk === 'string'
          ? chunk.length
          : undefined,
    type: 'cloudflare_stream_chunk',
  });
};
