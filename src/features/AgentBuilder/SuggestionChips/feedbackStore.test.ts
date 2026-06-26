import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiChatService } from '@/services/aiChat';

import { useBuilderSuggestionFeedbackStore } from './feedbackStore';

const TRACING_ID = 'trace-1';

describe('builderSuggestion feedbackStore', () => {
  const recordSpy = () => vi.mocked(aiChatService.recordTracingFeedback);

  beforeEach(() => {
    vi.spyOn(aiChatService, 'recordTracingFeedback').mockResolvedValue({ ok: true } as any);
    useBuilderSuggestionFeedbackStore.setState({ pending: undefined });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not emit on send when nothing is pending (normal send)', () => {
    useBuilderSuggestionFeedbackStore.getState().resolveOnSend('hello there');
    expect(recordSpy()).not.toHaveBeenCalled();
  });

  it('records usage_in_followup when the chip is sent verbatim', () => {
    const store = useBuilderSuggestionFeedbackStore.getState();
    store.markChipClicked({ index: 1, prompt: 'Refine this agent role', tracingId: TRACING_ID });
    store.resolveOnSend('Refine this agent role');

    expect(recordSpy()).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: 'positive',
        source: 'usage_in_followup',
        tracingId: TRACING_ID,
      }),
    );
    // pending cleared after resolution
    expect(useBuilderSuggestionFeedbackStore.getState().pending).toBeUndefined();
  });

  it('records manual_edit when the chip text is edited before sending', () => {
    const store = useBuilderSuggestionFeedbackStore.getState();
    store.markChipClicked({ index: 0, prompt: 'Refine this agent role', tracingId: TRACING_ID });
    store.resolveOnSend('Refine this agent role and add tools');

    expect(recordSpy()).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: 'positive',
        source: 'manual_edit',
        tracingId: TRACING_ID,
      }),
    );
  });

  it('records implicit_regenerate (negative) when switching batches', () => {
    useBuilderSuggestionFeedbackStore.getState().markRegenerated(TRACING_ID);

    expect(recordSpy()).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: 'negative',
        source: 'implicit_regenerate',
        tracingId: TRACING_ID,
      }),
    );
  });

  it('clears pending without emitting when sent text is empty', () => {
    const store = useBuilderSuggestionFeedbackStore.getState();
    store.markChipClicked({ index: 0, prompt: 'Refine role', tracingId: TRACING_ID });
    store.resolveOnSend('   ');

    expect(recordSpy()).not.toHaveBeenCalled();
    expect(useBuilderSuggestionFeedbackStore.getState().pending).toBeUndefined();
  });

  it('skips regenerate feedback when there is no tracingId', () => {
    useBuilderSuggestionFeedbackStore.getState().markRegenerated(undefined);
    expect(recordSpy()).not.toHaveBeenCalled();
  });
});
