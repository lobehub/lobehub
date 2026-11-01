import { z } from 'zod';

const recordSchema = z.record(z.string(), z.unknown());

export const chaosEffectSchema = z.discriminatedUnion('type', [
  z.object({ durationMs: z.number().int().nonnegative(), type: z.literal('delay') }).strict(),
  z.object({ count: z.number().int().min(2), type: z.literal('duplicate') }).strict(),
  z.object({ type: z.literal('drop') }).strict(),
  z
    .object({
      errorType: z.string().min(1),
      message: z.string().optional(),
      type: z.literal('throw'),
    })
    .strict(),
  z.object({ content: z.string(), type: z.literal('replace_result') }).strict(),
  z
    .object({
      signal: z.literal('SIGKILL').optional(),
      type: z.literal('kill_process'),
    })
    .strict(),
]);

export const chaosExperimentSchema = z
  .object({
    cleanup: z.enum(['always', 'on_success', 'never']).default('always'),
    description: z.string().min(1),
    discoveredFrom: z.string().optional(),
    effect: chaosEffectSchema,
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    layer: z.enum([
      'L0-infra',
      'L1-model-runtime',
      'L2-agent-runtime',
      'L3-orchestration',
      'L4-business-logic',
      'L5-human-trust',
    ]),
    oracles: z
      .array(
        z
          .object({
            name: z.string().min(1),
            params: recordSchema.optional(),
            timeoutMs: z.number().positive().optional(),
          })
          .strict(),
      )
      .min(1),
    safety: z
      .object({
        allowedEnvironments: z.array(z.string().min(1)).min(1),
        destructive: z.boolean().optional(),
        maxInjections: z.number().int().positive().optional(),
      })
      .strict(),
    seed: z.string().min(1),
    tags: z.array(z.string()).optional(),
    target: z.object({ adapter: z.string().min(1), selector: recordSchema }).strict(),
    timeoutMs: z.number().int().positive(),
    trigger: z
      .object({
        probability: z.number().min(0).max(1).optional(),
        when: z.enum(['immediate', 'before', 'after']),
      })
      .strict(),
  })
  .strict();
