import type { GenerateContentResponse } from '@google/genai';

import {
  appendProviderResponseEvent,
  appendRawProviderEvent,
  recordProviderStringContent,
} from '../../core/providerDiagnostics';
import type { ProviderResponseDiagnostics } from '../../types/providerDiagnostics';

interface GooglePart {
  fileData?: unknown;
  functionCall?: { args?: unknown; name?: string };
  inlineData?: unknown;
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
}

export const recordGoogleGenerateContentResponse = (
  diagnostics: ProviderResponseDiagnostics,
  response: GenerateContentResponse,
) => {
  appendRawProviderEvent(diagnostics, response);
  diagnostics.firstEventAt ??= Date.now();
  diagnostics.responseReceivedAt ??= Date.now();

  const rawResponse = response as GenerateContentResponse & {
    modelVersion?: string;
    promptFeedback?: { blockReason?: string };
    responseId?: string;
    usageMetadata?: unknown;
  };
  diagnostics.messageId ??= rawResponse.responseId;
  diagnostics.requestId ??= rawResponse.responseId;
  diagnostics.model ??= rawResponse.modelVersion;
  if (rawResponse.usageMetadata !== undefined) diagnostics.usage = rawResponse.usageMetadata;

  const event = { type: 'generate_content_response' };
  for (const candidate of rawResponse.candidates ?? []) {
    if (candidate.finishReason) {
      diagnostics.stopReason = candidate.finishReason;
      diagnostics.terminalEventReceived = true;
    }

    for (const rawPart of candidate.content?.parts ?? []) {
      const part = rawPart as GooglePart;
      if (typeof part.text === 'string') {
        recordProviderStringContent(
          diagnostics,
          event,
          part.text,
          part.thought ? 'thinking' : 'text',
        );
      }
      if (typeof part.thoughtSignature === 'string') {
        recordProviderStringContent(diagnostics, event, part.thoughtSignature, 'signature');
      }
      if (part.functionCall) {
        diagnostics.toolUseCount += 1;
        diagnostics.firstNonWhitespaceOutputAt ??= Date.now();
        if (part.functionCall.args !== undefined) {
          recordProviderStringContent(
            diagnostics,
            event,
            JSON.stringify(part.functionCall.args),
            'toolInput',
          );
        }
      }
      if (part.inlineData || part.fileData) diagnostics.firstNonWhitespaceOutputAt ??= Date.now();
    }
  }

  if (rawResponse.promptFeedback?.blockReason) {
    diagnostics.stopReason ??= rawResponse.promptFeedback.blockReason;
    diagnostics.terminalEventReceived = true;
  }

  appendProviderResponseEvent(diagnostics, event);
};
