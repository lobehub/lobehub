import type { Page } from '@playwright/test';
import { z } from 'zod';

const schema = z.object({
  gaps: z.array(z.string()).max(20),
  records: z
    .array(
      z.object({
        callId: z.number().int().nonnegative(),
        inputs: z.array(z.string().max(16384)).max(256),
        output: z.string().max(16384),
      }),
    )
    .max(512),
});
export type RuntimeCompositions = z.infer<typeof schema>;

export const readRuntimeCompositions = async (page: Page) =>
  schema.parse(
    await page.evaluate(() => {
      const field = (value: unknown, key: string) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor))
          throw new Error('COMPOSITION_DATA_DESCRIPTOR_REQUIRED');
        return descriptor.value;
      };
      const array = (value: unknown) => {
        if (!Array.isArray(value)) throw new Error('COMPOSITION_ARRAY_REQUIRED');
        const length = field(value, 'length');
        if (!Number.isSafeInteger(length) || length < 0 || length > 512)
          throw new Error('COMPOSITION_READ_BUDGET_EXCEEDED');
        return Array.from({ length }, (_, index) => field(value, String(index)));
      };
      const trace = field(globalThis, '__styleVerificationCompositions');
      return {
        gaps: array(field(trace, 'gaps')),
        records: array(field(trace, 'records')).map((record) => ({
          callId: field(record, 'callId'),
          inputs: array(field(record, 'inputs')),
          output: field(record, 'output'),
        })),
      };
    }),
  );
