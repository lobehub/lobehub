import { z } from 'zod';

/**
 * Validation of a widget's own metadata — title and description — shared by
 * every entry point that writes it (the widget router's create / update and
 * the dashboard agent tool's draft and update paths), so all enforce exactly
 * the same limits and the two paths cannot drift.
 */
export const widgetMetadataSchema = z.object({
  description: z.string().max(2000).nullish(),
  title: z.string().min(1).max(200),
});

/** Update entry points may send only one of the two fields. */
export const widgetMetadataPatchSchema = widgetMetadataSchema.partial();
