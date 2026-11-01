import {
  appendProviderResponseEvent,
  appendRawProviderEvent,
} from '../../core/providerDiagnostics';
import type { ProviderResponseDiagnostics } from '../../types/providerDiagnostics';

export const createAzureAIStreamChunkRecorder = () => {
  const decoder = new TextDecoder();

  return (diagnostics: ProviderResponseDiagnostics, chunk: unknown) => {
    const rawChunk = chunk instanceof Uint8Array ? decoder.decode(chunk, { stream: true }) : chunk;
    appendRawProviderEvent(diagnostics, rawChunk);
    diagnostics.firstEventAt ??= Date.now();
    diagnostics.responseReceivedAt ??= Date.now();
    appendProviderResponseEvent(diagnostics, {
      contentLength:
        typeof rawChunk === 'string' ? rawChunk.length : JSON.stringify(rawChunk).length,
      type: 'azure_ai_sse_chunk',
    });
  };
};
