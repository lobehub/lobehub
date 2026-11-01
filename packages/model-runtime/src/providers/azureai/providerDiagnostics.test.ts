import { describe, expect, it } from 'vitest';

import type { ProviderResponseDiagnostics } from '../../types/providerDiagnostics';
import { createAzureAIStreamChunkRecorder } from './providerDiagnostics';

describe('createAzureAIStreamChunkRecorder', () => {
  it('retains raw SSE bytes before the OpenAI protocol transformer', () => {
    const diagnostics: ProviderResponseDiagnostics = {
      apiMode: 'azure_ai_chat_completions',
      droppedEventCount: 0,
      eventCount: 0,
      eventCounts: {},
      events: [],
      hasNonWhitespaceText: false,
      hasNonWhitespaceThinking: false,
      rawEvents: [],
      signatureChars: 0,
      terminalEventReceived: false,
      textChars: 0,
      thinkingChars: 0,
      toolInputChars: 0,
      toolUseCount: 0,
    };
    const record = createAzureAIStreamChunkRecorder();

    record(diagnostics, new TextEncoder().encode('data: {"choices":[]}\n\n'));

    expect(diagnostics.rawEvents).toEqual(['data: {"choices":[]}\n\n']);
    expect(diagnostics.eventCounts).toEqual({ azure_ai_sse_chunk: 1 });
  });
});
