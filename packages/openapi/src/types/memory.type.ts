import { z } from 'zod';

/** Id of a single memory entry inside its category. */
export const MemoryEntryIdParamSchema = z.object({
  id: z.string().min(1),
});
export type MemoryEntryIdParam = z.infer<typeof MemoryEntryIdParamSchema>;

/** The six memory categories a client can read and prune individually. */
export const MEMORY_CATEGORIES = [
  'identities',
  'preferences',
  'contexts',
  'activities',
  'experiences',
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MemoryCategoryParamSchema = z.object({
  category: z.enum(MEMORY_CATEGORIES),
});
export type MemoryCategoryParam = z.infer<typeof MemoryCategoryParamSchema>;

export const MemoryEntryPathParamSchema = MemoryCategoryParamSchema.extend(
  MemoryEntryIdParamSchema.shape,
);
export type MemoryEntryPathParam = z.infer<typeof MemoryEntryPathParamSchema>;
