import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { getLLMGenerationTracingService } from '@/server/services/llmGenerationTracing';

/**
 * General-purpose feedback endpoint for any `llm_generation_tracing` row.
 *
 * Designed scenario-agnostically: any caller that holds a `tracingId`
 * (returned by the originating mutation, e.g. `aiChat.outputJSON`) can
 * report a positive / negative / neutral signal. Scenario-specific detail
 * goes into `data` so we don't need a new endpoint per use case.
 */
export const llmGenerationTracingRouter = router({
  recordFeedback: authedProcedure
    .input(
      z.object({
        /** Free-form jsonb detail (e.g. accepted suggestion text, retry count). */
        data: z.record(z.string(), z.unknown()).optional(),
        /** Continuous score in [-1, 1], if the caller has a finer-grained metric. */
        score: z.number().min(-1).max(1).optional(),
        /** Feedback polarity. */
        signal: z.enum(['positive', 'negative', 'neutral']),
        /**
         * What triggered the feedback. Common values include `explicit_thumbs`,
         * `implicit_regenerate`, `downstream_acceptance`, `manual_edit`,
         * `usage_in_followup`. Free-form string so callers can introduce new
         * sources without DB migration.
         */
        source: z.string().min(1),
        /** Tracing row id returned by the originating generation route. */
        tracingId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getLLMGenerationTracingService().recordFeedback(ctx.userId, input.tracingId, {
        data: input.data,
        score: input.score,
        signal: input.signal,
        source: input.source,
      });
      return { ok: true as const };
    }),
});
