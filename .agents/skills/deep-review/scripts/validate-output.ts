import { readFile } from 'node:fs/promises';

import { z } from 'zod';

const WorkflowFeedbackSchema = z
  .object({
    suggestion: z.string().min(1),
    why: z.string().min(1),
  })
  .strict();

const ReviewIssueSchema = z
  .object({
    core_problem: z.string().min(1),
    dimension: z.string().min(1),
    existing_implementations: z.array(z.string().min(1)).min(1).optional(),
    exposure: z.enum(['triggered', 'bystander']).optional(),
    fix_cost: z.enum(['low', 'medium', 'high']),
    fix_options: z.array(z.string().min(1)).min(1),
    id: z.string().min(1),
    issue_type: z.string().min(1),
    likelihood: z.enum(['high', 'medium', 'low']),
    location: z.string().min(1),
    nature: z.enum(['introduced', 'exposed_legacy']),
    need_test: z.boolean(),
    rule_source: z.string().min(1).optional(),
    scenario: z.string().min(1).optional(),
    severity: z.enum(['p0', 'p1', 'p2']),
    summary: z.string().min(1),
  })
  .strict()
  .superRefine((issue, context) => {
    if (issue.nature === 'exposed_legacy' && (!issue.exposure || !issue.scenario)) {
      context.addIssue({
        code: 'custom',
        message: 'exposed_legacy findings require exposure and scenario',
      });
    }

    if (issue.nature === 'introduced' && issue.exposure) {
      context.addIssue({
        code: 'custom',
        message: 'introduced findings must omit exposure',
      });
    }

    if (issue.likelihood === 'low' && !issue.scenario) {
      context.addIssue({
        code: 'custom',
        message: 'low-likelihood findings require scenario',
      });
    }

    if (issue.dimension === 'reuse-architecture' && !issue.existing_implementations) {
      context.addIssue({
        code: 'custom',
        message: 'reuse-architecture findings require existing_implementations',
      });
    }
  });

const ReviewOutputSchema = z
  .object({
    issues: z.array(ReviewIssueSchema),
    missing_sources: z.array(z.string().min(1)).optional(),
    release_checks: z
      .array(
        z
          .object({
            blocks_deploy: z.boolean(),
            item: z.string().min(1),
            why: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
    workflow_feedback: z.array(WorkflowFeedbackSchema).optional(),
  })
  .strict()
  .superRefine(({ issues }, context) => {
    const ids = issues.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'issue ids must be unique' });
    }
  });

const ConfirmedVerificationSchema = z
  .object({
    auto_fix_reason: z.string().min(1).nullable().optional(),
    blocks_release: z.boolean(),
    can_auto_fix: z.boolean(),
    culprit: z.string().min(1).nullable().optional(),
    evidence: z.string().min(1),
    exposure_override: z.enum(['triggered', 'bystander']).nullable().optional(),
    fix_options_override: z.array(z.string().min(1)).min(1).nullable().optional(),
    id: z.string().min(1),
    likelihood_override: z.enum(['high', 'medium', 'low']).nullable().optional(),
    nature_override: z.enum(['introduced', 'exposed_legacy']).nullable().optional(),
    note: z.string().min(1).nullable().optional(),
    severity_override: z.enum(['p0', 'p1', 'p2']).nullable().optional(),
    verdict: z.literal('confirmed'),
  })
  .strict()
  .superRefine((verification, context) => {
    if (!verification.can_auto_fix && !verification.auto_fix_reason) {
      context.addIssue({
        code: 'custom',
        message: 'non-auto-fix confirmations require auto_fix_reason',
      });
    }
  });

const VerificationOutputSchema = z
  .object({
    verifications: z.array(
      z.discriminatedUnion('verdict', [
        ConfirmedVerificationSchema,
        z
          .object({
            id: z.string().min(1),
            reason: z.string().min(1),
            verdict: z.literal('false_positive'),
          })
          .strict(),
        z
          .object({
            id: z.string().min(1),
            missing: z.string().min(1),
            verdict: z.literal('need_more_context'),
          })
          .strict(),
      ]),
    ),
    workflow_feedback: z.array(WorkflowFeedbackSchema).optional(),
  })
  .strict()
  .superRefine(({ verifications }, context) => {
    const ids = verifications.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'verification ids must be unique' });
    }
  });

const ConsolidationOutputSchema = z
  .object({
    same_root: z.array(
      z
        .object({
          id: z.string().min(1),
          same_root_as: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine(({ same_root }, context) => {
    const ids = same_root.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'consolidation ids must be unique' });
    }
  });

const schemas = {
  consolidate: ConsolidationOutputSchema,
  review: ReviewOutputSchema,
  verify: VerificationOutputSchema,
} as const;

export type OutputKind = keyof typeof schemas;

export const extractJsonPayload = (raw: string) => {
  const trimmed = raw.trim();
  const normalized = trimmed.toLowerCase();
  const fenceStart = normalized.indexOf('```json');
  if (fenceStart === -1) return trimmed;
  if (normalized.includes('```json', fenceStart + '```json'.length)) {
    throw new Error('Multiple JSON fences found');
  }

  const payloadStart = fenceStart + '```json'.length;
  const fenceEnd = trimmed.indexOf('```', payloadStart);
  if (fenceEnd === -1) throw new Error('JSON fence is not closed');

  return trimmed.slice(payloadStart, fenceEnd).trim();
};

export const validateOutput = (kind: OutputKind, value: unknown) => schemas[kind].parse(value);

const readStdin = async () => {
  process.stdin.setEncoding('utf8');

  let input = '';
  for await (const chunk of process.stdin as AsyncIterable<string>) input += chunk;
  return input;
};

const run = async () => {
  const kind = process.argv[2] as OutputKind | undefined;
  const inputPath = process.argv[3];

  if (!kind || !(kind in schemas)) {
    throw new Error('Usage: validate-output.ts <review|verify|consolidate> [input-file]');
  }

  const raw = inputPath ? await readFile(inputPath, 'utf8') : await readStdin();
  const value = JSON.parse(extractJsonPayload(raw));
  validateOutput(kind, value);
  console.log(`Valid ${kind} output`);
};

if (import.meta.main) {
  await run().catch((error) => {
    if (error instanceof z.ZodError) {
      console.error(JSON.stringify(error.issues, null, 2));
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  });
}
