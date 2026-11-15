import {
  ActivityMemoryItemSchema,
  AddIdentityActionSchema,
  ContextMemoryItemSchema,
  ExperienceMemoryItemSchema,
  PreferenceMemoryItemSchema,
} from '@lobechat/memory-user-memory/schemas';
import type { EvalMemoryFixture } from '@lobechat/types';
import { z } from 'zod';

const nativeEvalMemoryFixtureSchema = z
  .object({
    activities: z.array(ActivityMemoryItemSchema.strict()).max(50).optional(),
    contexts: z.array(ContextMemoryItemSchema.strict()).max(50).optional(),
    experiences: z.array(ExperienceMemoryItemSchema.strict()).max(50).optional(),
    identities: z.array(AddIdentityActionSchema).max(50).optional(),
    persona: z
      .object({ narrative: z.string().max(50_000), tagline: z.string().max(2000).optional() })
      .strict()
      .optional(),
    preferences: z.array(PreferenceMemoryItemSchema.strict()).max(50).optional(),
    seededAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((fixture, ctx) => {
    const count = Object.values(fixture).reduce(
      (total, value) => total + (Array.isArray(value) ? value.length : 0),
      0,
    );
    if (count > 50 || JSON.stringify(fixture).length > 200_000) {
      ctx.addIssue({
        code: 'custom',
        message: 'Memory fixture exceeds 50 entries or 200000 characters',
      });
    }
    // Account message references cannot be rebound to a new namespace.
    const checkSources = (value: unknown, path: (string | number)[]) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => checkSources(item, [...path, index]));
      } else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          if (
            (key === 'sourceId' || key === 'sourceIds') &&
            item != null &&
            (Array.isArray(item) ? item.length > 0 : item !== '')
          ) {
            ctx.addIssue({
              code: 'custom',
              message: 'Memory fixtures cannot reference account source messages',
              path: [...path, key],
            });
          }
          checkSources(item, [...path, key]);
        }
      }
    };
    checkSources(fixture, []);
  });

/**
 * Keep the shared transport type independent of the Memory schema package
 * (which itself imports @lobechat/types), and validate every nested native
 * input here. The transform's output is the precise native schema type used
 * by the seed service; invalid transport input never reaches execution.
 */
export const evalMemoryFixtureSchema = z.custom<EvalMemoryFixture>().transform((fixture, ctx) => {
  const result = nativeEvalMemoryFixtureSchema.safeParse(fixture);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
    return z.NEVER;
  }
  return result.data;
});
