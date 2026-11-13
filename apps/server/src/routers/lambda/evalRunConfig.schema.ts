import { AgentChatConfigSchema } from '@lobechat/types';
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
 * Contender settings of a model-only run; applied to every case's hidden Agent.
 * The model settings the chat model-params panel offers (reasoning switch and
 * effort, thinking level and budget, verbosity …), validated as the Agent
 * chatConfig validates them.
 */
export const evalRunChatConfigSchema = AgentChatConfigSchema.pick({
  codexMaxReasoningEffort: true,
  deepseekV4GAReasoningEffort: true,
  deepseekV4ReasoningEffort: true,
  disableContextCaching: true,
  effort: true,
  enableAdaptiveThinking: true,
  enableReasoning: true,
  glm5_2ReasoningEffort: true,
  glm5_3ReasoningEffort: true,
  gpt5_1ReasoningEffort: true,
  gpt5_2ProReasoningEffort: true,
  gpt5_2ReasoningEffort: true,
  gpt5_6ReasoningEffort: true,
  gpt5ReasoningEffort: true,
  gpt6ReasoningEffort: true,
  grok4_20ReasoningEffort: true,
  grok4_3ReasoningEffort: true,
  grok4_5ReasoningEffort: true,
  grok4_6ReasoningEffort: true,
  grok4_7ReasoningEffort: true,
  hy3ReasoningEffort: true,
  kimiK3ReasoningEffort: true,
  opus47Effort: true,
  preserveThinking: true,
  qwen38ReasoningEffort: true,
  reasoningBudgetToken: true,
  reasoningBudgetToken32k: true,
  reasoningBudgetToken80k: true,
  reasoningEffort: true,
  reasoningMode: true,
  ring2_6ReasoningEffort: true,
  step3_5ReasoningEffort: true,
  textVerbosity: true,
  thinking: true,
  thinkingBudget: true,
  thinkingLevel: true,
  thinkingLevel2: true,
  thinkingLevel3: true,
  thinkingLevel4: true,
}).strict();

export const evalRunModelParamsSchema = z
  .object({
    frequency_penalty: z.number().min(-2).max(2).optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
  })
  .strict();

/**
 * User-facing config for creating an eval run. Shared by the internal
 * (agentEval) and external (agentEvalExternal) routers.
 */
export const evalRunInputConfigSchema = z
  .object({
    caseSelection: evalCaseSelectionSchema.optional(),
    chatConfig: evalRunChatConfigSchema.optional(),
    /** The judge of this run; absent, the case, case set or benchmark judge applies. */
    judgeModel: z.string().trim().min(1).optional(),
    judgeProvider: z.string().trim().min(1).optional(),
    k: z.number().min(1).max(10).optional(),
    maxConcurrency: z.number().min(1).max(20).optional(),
    maxSteps: z.number().min(1).max(1000).optional(),
    model: z.string().trim().min(1).optional(),
    params: evalRunModelParamsSchema.optional(),
    provider: z.string().trim().min(1).optional(),
    timeout: z
      .number()
      .min(60_000)
      .max(6 * 3_600_000)
      .optional(),
  })
  .refine((config) => Boolean(config.model) === Boolean(config.provider), {
    message: 'model and provider must be set together',
    path: ['provider'],
  })
  .refine((config) => Boolean(config.judgeModel) === Boolean(config.judgeProvider), {
    message: 'judgeModel and judgeProvider must be set together',
    path: ['judgeProvider'],
  });
