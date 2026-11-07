import { describe, expect, it } from 'vitest';

import type { ProviderResponseDiagnostics } from '../../types/providerDiagnostics';
import {
  appendRawProviderEvent,
  captureRawProviderResponse,
  waitForRawProviderResponse,
} from '../providerDiagnostics';

const createDiagnostics = (): ProviderResponseDiagnostics => ({
  apiMode: 'test',
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

describe('providerDiagnostics', () => {
  it('caps the number of retained provider events', () => {
    const diagnostics = createDiagnostics();

    for (let index = 0; index < 129; index++) {
      appendRawProviderEvent(diagnostics, { index, type: 'chunk' });
    }

    expect(diagnostics.rawEvents).toHaveLength(128);
    expect(diagnostics.droppedRawEventCount).toBe(1);
    expect(diagnostics.rawEventByteLength).toBeGreaterThan(0);
  });

  it('drops a provider event that exceeds the retained byte budget', () => {
    const diagnostics = createDiagnostics();

    appendRawProviderEvent(diagnostics, { content: 'x'.repeat(300 * 1024) });

    expect(diagnostics.rawEvents).toEqual([]);
    expect(diagnostics.droppedRawEventCount).toBe(1);
    expect(diagnostics.rawEventByteLength).toBeUndefined();
  });

  it('stops reading a raw response after the retained byte budget', async () => {
    const diagnostics = createDiagnostics();

    captureRawProviderResponse(diagnostics, new Response('x'.repeat(300 * 1024)));
    await waitForRawProviderResponse(diagnostics);

    expect(diagnostics.rawResponse).toMatchObject({
      byteLength: 256 * 1024,
      status: 'captured',
      truncated: true,
    });
    expect(diagnostics.rawResponse?.body).toHaveLength(256 * 1024);
  });
});
