import { verifyCheckDefinitionSchema } from '@lobechat/types';
import { z } from 'zod';

export const verifierTypeSchema = z.enum(['program', 'agent', 'llm']);

export const onFailSchema = z.enum(['manual', 'auto_repair']);

export const modelConfigSchema = z.object({ model: z.string(), provider: z.string() });

export const verdictSchema = z.enum(['passed', 'failed', 'uncertain']);

export const checkItemSchema = z.object({
  definition: verifyCheckDefinitionSchema.optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  id: z.string(),
  index: z.number(),
  onFail: onFailSchema,
  required: z.boolean(),
  sourceCriterionId: z.string().nullish(),
  sourceRubricId: z.string().nullish(),
  supersedes: z.array(z.string()).optional(),
  title: z.string(),
  verifierConfig: z.record(z.string(), z.unknown()),
  verifierType: verifierTypeSchema,
});

export const verifyRunIdInputSchema = z.object({ verifyRunId: z.string() });
