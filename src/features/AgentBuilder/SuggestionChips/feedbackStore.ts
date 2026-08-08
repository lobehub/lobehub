import { create } from 'zustand';

import { aiChatService, type RecordTracingFeedbackParams } from '@/services/aiChat';

export interface PendingBuilderSuggestion {
  /** Index of the clicked chip within its batch (for `feedbackData`). */
  index: number;
  /** The chip's prompt text inserted into the input — compared at send time. */
  prompt: string;
  /** Tracing row id of the generation this chip came from. */
  tracingId: string;
}

interface BuilderSuggestionFeedbackStore {
  /** Marks a chip click; its text is inserted into the input, awaiting send. */
  markChipClicked: (pending: PendingBuilderSuggestion) => void;
  /**
   * Negative signal: the user asked for a different batch ("switch") without
   * sending any chip from the current one. Keyed by the batch's tracingId.
   */
  markRegenerated: (tracingId?: string) => void;
  pending?: PendingBuilderSuggestion;
  /** Clears any pending suggestion without emitting feedback. */
  reset: () => void;
  /**
   * Resolves a pending chip when the user actually sends a message:
   * sent verbatim → `usage_in_followup`, edited first → `manual_edit`.
   * No-op when nothing is pending (i.e. a normal, non-suggestion send).
   */
  resolveOnSend: (sentText: string) => void;
}

const emit = (params: RecordTracingFeedbackParams) =>
  aiChatService.recordTracingFeedback(params).catch((err) => {
    console.warn('[BuilderSuggestion] recordFeedback failed', err);
  });

export const useBuilderSuggestionFeedbackStore = create<BuilderSuggestionFeedbackStore>(
  (set, get) => ({
    markChipClicked: (pending) => set({ pending }),

    markRegenerated: (tracingId) => {
      set({ pending: undefined });
      if (!tracingId) return;
      emit({ score: -0.5, signal: 'negative', source: 'implicit_regenerate', tracingId });
    },

    reset: () => set({ pending: undefined }),

    resolveOnSend: (sentText) => {
      const { pending } = get();
      if (!pending) return;
      set({ pending: undefined });

      const sent = sentText.trim();
      if (!sent) return;

      const usedAsIs = sent === pending.prompt.trim();
      emit({
        data: { chipIndex: pending.index, edited: !usedAsIs },
        score: usedAsIs ? 0.6 : 0.3,
        signal: 'positive',
        source: usedAsIs ? 'usage_in_followup' : 'manual_edit',
        tracingId: pending.tracingId,
      });
    },
  }),
);
