import { widgetContentSchema } from '@lobechat/widget-spec';
import { z } from 'zod';

export { widgetManifestSchema, widgetViewSchema } from '@lobechat/widget-spec';

/**
 * Validation of a widget version's authored content, shared by every
 * entry point that records a draft so all accept exactly the same content.
 * The content rules live in `@lobechat/widget-spec`, which presets share.
 */
export const widgetVersionContentSchema = widgetContentSchema.extend({
  changeNote: z.string().max(500).nullish(),
});
