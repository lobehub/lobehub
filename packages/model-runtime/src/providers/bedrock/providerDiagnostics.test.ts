import { describe, expect, it } from 'vitest';

import type { ProviderResponseDiagnostics } from '../../types/providerDiagnostics';
import { recordBedrockResponseEvent } from './providerDiagnostics';

const createDiagnostics = (): ProviderResponseDiagnostics => ({
  apiMode: 'bedrock_claude_messages',
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
});

describe('recordBedrockResponseEvent', () => {
  it('retains provider-native Claude chunks and terminal metadata', () => {
    const diagnostics = createDiagnostics();
    const chunks = [
      {
        message: { id: 'message-1', model: 'claude', usage: { input_tokens: 10 } },
        type: 'message_start',
      },
      { delta: { text: '' }, type: 'content_block_delta' },
      {
        delta: { stop_reason: 'end_turn' },
        type: 'message_delta',
        usage: { output_tokens: 147 },
      },
      { type: 'message_stop' },
    ];

    for (const chunk of chunks) recordBedrockResponseEvent(diagnostics, chunk);

    expect(diagnostics).toMatchObject({
      eventCount: 4,
      hasNonWhitespaceText: false,
      messageId: 'message-1',
      model: 'claude',
      rawEvents: chunks,
      stopReason: 'end_turn',
      terminalEventReceived: true,
      textChars: 0,
      usage: { output_tokens: 147 },
    });
  });
});
