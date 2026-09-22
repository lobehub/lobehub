import { toRecord } from '@lobechat/utils/object';

import {
  appendProviderResponseEvent,
  appendRawProviderEvent,
  recordProviderStringContent,
} from '../../core/providerDiagnostics';
import type { ProviderResponseDiagnostics } from '../../types/providerDiagnostics';

export const recordBedrockResponseEvent = (
  diagnostics: ProviderResponseDiagnostics,
  chunk: unknown,
) => {
  appendRawProviderEvent(diagnostics, chunk);
  diagnostics.firstEventAt ??= Date.now();
  diagnostics.responseReceivedAt ??= Date.now();

  const raw = toRecord(chunk);
  const type = typeof raw?.type === 'string' ? raw.type : 'bedrock_chunk';
  const event = { type };

  const message = toRecord(raw?.message);
  if (message) {
    if (typeof message.id === 'string') diagnostics.messageId ??= message.id;
    if (typeof message.model === 'string') diagnostics.model ??= message.model;
    if (message.usage !== undefined) diagnostics.usage = message.usage;
  }

  const contentBlock = toRecord(raw?.content_block);
  if (contentBlock?.type === 'tool_use') {
    diagnostics.toolUseCount += 1;
    diagnostics.firstNonWhitespaceOutputAt ??= Date.now();
  }
  if (typeof contentBlock?.text === 'string') {
    recordProviderStringContent(diagnostics, event, contentBlock.text, 'text');
  }
  if (typeof contentBlock?.thinking === 'string') {
    recordProviderStringContent(diagnostics, event, contentBlock.thinking, 'thinking');
  }

  const delta = toRecord(raw?.delta);
  if (typeof delta?.text === 'string') {
    recordProviderStringContent(diagnostics, event, delta.text, 'text');
  }
  if (typeof delta?.thinking === 'string') {
    recordProviderStringContent(diagnostics, event, delta.thinking, 'thinking');
  }
  if (typeof delta?.signature === 'string') {
    recordProviderStringContent(diagnostics, event, delta.signature, 'signature');
  }
  if (typeof delta?.partial_json === 'string') {
    recordProviderStringContent(diagnostics, event, delta.partial_json, 'toolInput');
  }
  if (typeof delta?.stop_reason === 'string') {
    diagnostics.stopReason = delta.stop_reason;
    diagnostics.terminalEventReceived = true;
  }

  if (typeof raw?.generation === 'string') {
    recordProviderStringContent(diagnostics, event, raw.generation, 'text');
  }
  if (typeof raw?.stop_reason === 'string') {
    diagnostics.stopReason = raw.stop_reason;
    diagnostics.terminalEventReceived = true;
  }
  if (raw?.usage !== undefined) diagnostics.usage = raw.usage;
  if (type === 'message_stop') diagnostics.terminalEventReceived = true;

  appendProviderResponseEvent(diagnostics, event);
};
