import { z } from 'zod';

/**
 * Case selection for scoping a run to a subset of dataset cases.
 * Stored verbatim in the run config (Exp Proposal ↔ Run Config consistency
 * checks). Canonical form: "all cases" is represented by OMITTING
 * caseSelection — never persist a second "all" representation.
 *
 * Boundary acceptance + normalization:
 * - {mode:'all'} with absent or empty caseIds → accepted, normalized to omitted
 * - {mode:'all'} with non-empty caseIds → rejected
 * - {mode:'exclude'} with missing/empty caseIds → accepted, normalized to omitted
 * - {mode:'include'} with missing/empty caseIds → rejected
 * - valid include/exclude → persisted unchanged (unique, non-blank ids)
 */
export const evalCaseSelectionSchema = z
  .object({
    mode: z.enum(['all', 'include', 'exclude']),
    caseIds: z.array(z.string()).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'all') {
      if (val.caseIds && val.caseIds.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'caseIds must be absent or empty when mode is "all"',
        });
      }
      return;
    }

    const ids = val.caseIds ?? [];
    if (ids.length === 0) {
      if (val.mode === 'include') {
        ctx.addIssue({
          code: 'custom',
          message: 'caseIds must be non-empty when mode is "include"',
        });
      }
      // exclude with missing/empty caseIds normalizes to all — allowed
      return;
    }

    if (ids.some((id) => id.trim().length === 0)) {
      ctx.addIssue({ code: 'custom', message: 'caseIds must not contain blank values' });
    }
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'caseIds must be unique' });
    }
  })
  .transform((val) => {
    // Canonicalize "all cases" to omission.
    if (val.mode === 'all') return undefined;
    if (val.mode === 'exclude' && (!val.caseIds || val.caseIds.length === 0)) return undefined;
    return val;
  });

/**
 * User-facing config for creating an eval run. Shared by the internal
 * (agentEval) and external (agentEvalExternal) routers.
 */
export const evalRunInputConfigSchema = z.object({
  caseSelection: evalCaseSelectionSchema.optional(),
  k: z.number().min(1).max(10).optional(),
  maxConcurrency: z.number().min(1).max(20).optional(),
  maxSteps: z.number().min(1).max(1000).optional(),
  timeout: z
    .number()
    .min(60_000)
    .max(6 * 3_600_000)
    .optional(),
});
