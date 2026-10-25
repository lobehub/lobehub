import { acceptanceSubjectTypes } from '@lobechat/const/verify';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { acceptanceProcedure, acceptanceWriteProcedure } from './procedures';

const subjectTypeSchema = z.enum(acceptanceSubjectTypes);

export const subjectRouter = router({
  /** Get (or lazily create) the aggregate for a subject — the ingest entry point. */
  ensure: acceptanceWriteProcedure
    .input(
      z.object({
        /**
         * Set by report ingest when the topic came from the ambient
         * `LOBEHUB_TOPIC_ID`: a Task's run topic then lands on the Task. An
         * explicitly requested subject is always kept exact.
         */
        foldTaskRunTopic: z.boolean().optional(),
        /**
         * The project the delivery's repository declares — used only when
         * the subject implies none. Only fills an aggregate that has none yet.
         */
        fallbackProjectId: z.string().min(1).optional(),
        /**
         * A project the caller names, overriding the one the subject implies.
         * Only fills an aggregate that has none yet.
         */
        projectId: z.string().min(1).optional(),
        requirement: z.string().max(2000).optional(),
        subjectId: z.string(),
        subjectType: subjectTypeSchema,
        title: z.string().trim().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const defaults = {
        fallbackProjectId: input.fallbackProjectId,
        projectId: input.projectId,
        requirement: input.requirement,
        title: input.title,
      };
      try {
        return input.foldTaskRunTopic
          ? await ctx.acceptanceService.ensureForIngest(
              input.subjectType,
              input.subjectId,
              defaults,
            )
          : await ctx.acceptanceService.ensureForSubject(
              input.subjectType,
              input.subjectId,
              defaults,
            );
      } catch (error) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: error instanceof Error ? error.message : 'Acceptance subject not found',
        });
      }
    }),
  /** The acceptance row for a subject, or null when none exists yet. */
  getBySubject: acceptanceProcedure
    .input(z.object({ subjectId: z.string(), subjectType: subjectTypeSchema }))
    .query(async ({ ctx, input }) => {
      // `task:T-898` and `task:task_xxx` name the same aggregate.
      const subjectId = await ctx.acceptanceService.resolveCanonicalSubjectId(
        input.subjectType,
        input.subjectId,
      );
      const acceptance = await ctx.acceptanceService.acceptanceModel.findBySubject(
        input.subjectType,
        subjectId,
      );
      if (!acceptance) return null;

      // `delivered` alone is ambiguous for the subject's status surface: a
      // converged delivery waiting for sign-off and a failed one waiting for a
      // decision both land there. The latest round's verdict is what tells
      // them apart, so ship it with the aggregate instead of forcing callers
      // to load the whole bundle for one field.
      const latest = await ctx.acceptanceService.latestRound(acceptance.id);
      return {
        ...acceptance,
        latestRunStatus: latest?.status ?? null,
        latestRunUserDecision: latest?.userDecision ?? null,
      };
    }),
  /**
   * Persist a subject's standing acceptance checklist (the topic tray). Ensures
   * the aggregate exists, then writes the list into its `config.checklist` — so
   * the criteria live with the verify aggregate, not in client storage.
   */
  saveChecklist: acceptanceWriteProcedure
    .input(
      z.object({
        checklist: z.array(
          z.object({
            id: z.string(),
            method: z.string().optional(),
            name: z.string(),
          }),
        ),
        subjectId: z.string(),
        subjectType: subjectTypeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const aggregate = await ctx.acceptanceService.ensureForSubject(
          input.subjectType,
          input.subjectId,
        );
        await ctx.acceptanceService.acceptanceModel.update(aggregate.id, {
          config: { ...aggregate.config, checklist: input.checklist },
        });
        return { checklist: input.checklist, id: aggregate.id };
      } catch (error) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: error instanceof Error ? error.message : 'Acceptance subject not found',
        });
      }
    }),
  /**
   * Set (or update) a subject's acceptance goal — the one-sentence outcome the
   * conversation is delivering. Unlike `ensure`, this overwrites: the goal is a
   * user-editable field, so a later edit must stick.
   */
  saveGoal: acceptanceWriteProcedure
    .input(
      z.object({
        requirement: z.string().max(2000),
        subjectId: z.string(),
        subjectType: subjectTypeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const aggregate = await ctx.acceptanceService.ensureForSubject(
          input.subjectType,
          input.subjectId,
        );
        await ctx.acceptanceService.acceptanceModel.update(aggregate.id, {
          requirement: input.requirement,
        });
        return { id: aggregate.id, requirement: input.requirement };
      } catch (error) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: error instanceof Error ? error.message : 'Acceptance subject not found',
        });
      }
    }),
  /**
   * Acceptance status for a known set of subjects, in one read.
   *
   * `list` is recency-capped and spans every subject type, so a list surface
   * that derived per-row state from it would silently mis-read any subject
   * pushed past the cap. This answers about exactly the subjects asked for.
   */
  listStatusesBySubjects: acceptanceProcedure
    .input(
      z.object({
        subjectIds: z.array(z.string()).max(200),
        subjectType: subjectTypeSchema,
      }),
    )
    .query(async ({ ctx, input }) =>
      ctx.acceptanceService.acceptanceModel.listStatusesBySubjects(
        input.subjectType,
        input.subjectIds,
      ),
    ),
});
