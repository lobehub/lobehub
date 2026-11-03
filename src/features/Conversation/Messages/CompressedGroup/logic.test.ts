import { describe, expect, it } from 'vitest';

import {
  getCompressedTurnCount,
  isCompressionSummaryGenerating,
  shouldShowCompressedGroupPanel,
} from './logic';

describe('CompressedGroup logic', () => {
  it.each(['generateSummary', 'contextCompression'])(
    'should treat %s as summary generation state',
    (operationType) => {
      expect(isCompressionSummaryGenerating(operationType)).toBe(true);
      expect(
        shouldShowCompressedGroupPanel({
          expanded: true,
          isGeneratingSummary: isCompressionSummaryGenerating(operationType),
        }),
      ).toBe(false);
    },
  );

  it('should show the summary/history panel when generation is finished and group is expanded', () => {
    expect(isCompressionSummaryGenerating('sendMessage')).toBe(false);
    expect(
      shouldShowCompressedGroupPanel({
        expanded: true,
        isGeneratingSummary: false,
      }),
    ).toBe(true);
  });

  it('should keep the panel hidden when the group is collapsed', () => {
    expect(
      shouldShowCompressedGroupPanel({
        expanded: false,
        isGeneratingSummary: false,
      }),
    ).toBe(false);
  });
});

describe('getCompressedTurnCount', () => {
  it('counts user messages as conversation turns', () => {
    const compressedMessages = [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 'u2', role: 'user' },
      { id: 'a2', role: 'assistantGroup' },
    ] as any;

    expect(getCompressedTurnCount({ compressedMessages })).toBe(2);
  });

  it('prefers the whole-group turn count of a capped read over the hydrated slice', () => {
    const compressedMessages = [{ id: 'u300', role: 'user' }] as any;

    expect(getCompressedTurnCount({ compressedMessages, compressedTurnCount: 2600 })).toBe(2600);
  });

  it('falls back to the message count when no user message is present', () => {
    const compressedMessages = [
      { id: 'a1', role: 'assistant' },
      { id: 'a2', role: 'assistant' },
    ] as any;

    expect(getCompressedTurnCount({ compressedMessages })).toBe(2);
  });

  it('uses the server-side original message count before the detail arrives', () => {
    expect(getCompressedTurnCount({ originalMessageCount: 3 })).toBe(3);
  });

  it('returns zero when the group carries no count at all', () => {
    expect(getCompressedTurnCount({})).toBe(0);
  });
});
