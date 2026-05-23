import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import {
  getLLMGenerationTracingService,
  LLMGenerationFeedbackError,
} from '@/server/services/llmGenerationTracing';

/**
 * General-purpose feedback endpoint for any `llm_generation_tracing` row.
 *
 * Designed scenario-agnostically: any caller that holds a `tracingId`
 * (returned by the originating mutation, e.g. `aiChat.outputJSON`) can
 * report a positive / negative / neutral signal. Scenario-specific detail
 * goes into `data` so we don't need a new endpoint per use case.
 *
 * **Failure surfacing**: `{ ok: true }` only flows back when a row actually
 * matched and was patched. A missing/foreign row produces `NOT_FOUND`; a DB
 * outage produces `INTERNAL_SERVER_ERROR`. Callers can therefore distinguish
 * "give up, this id is stale" from "transient, retry later".
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
      try {
        await getLLMGenerationTracingService().recordFeedback(ctx.userId, input.tracingId, {
          data: input.data,
          score: input.score,
          signal: input.signal,
          source: input.source,
        });
      } catch (err) {
        if (err instanceof LLMGenerationFeedbackError) {
          throw new TRPCError({
            cause: err,
            code: err.kind === 'not_found' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
            message: err.message,
          });
        }
        throw err;
      }
      return { ok: true as const };
    }),
});
