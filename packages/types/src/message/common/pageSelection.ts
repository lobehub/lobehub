import { z } from 'zod';

import type { ContextSelectionBase } from './contextSelection';
import { ContextSelectionBaseSchema } from './contextSelection';

/**
 * Page selection represents a user-selected text region in a page/document.
 * Used for Ask AI functionality to persist selection context with user messages.
 */
export interface PageSelection extends Omit<ContextSelectionBase, 'lineRange'> {
  anchor?: {
    startNodeId: string;
    endNodeId: string;
    startOffset: number;
    endOffset: number;
  };
  /** Selected content (plain text or markdown) */
  content: string;
  /** End line number */
  endLine?: number;
  /** Selection unique identifier */
  id: string;
  /** Page ID the selection belongs to */
  pageId: string;
  /** Start line number */
  startLine?: number;
  /** XML structure of the selected content (for positioning edits) */
  xml?: string;
}

export const PageSelectionSchema = ContextSelectionBaseSchema.omit({ lineRange: true }).extend({
  anchor: z
    .object({
      endNodeId: z.string(),
      endOffset: z.number(),
      startNodeId: z.string(),
      startOffset: z.number(),
    })
    .optional(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  pageId: z.string(),
  xml: z.string().optional(),
});
