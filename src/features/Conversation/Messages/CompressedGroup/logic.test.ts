import { describe, expect, it } from 'vitest';

import { isCompressionSummaryGenerating, shouldShowCompressedGroupPanel } from './logic';

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
