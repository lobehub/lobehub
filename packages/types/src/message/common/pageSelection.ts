/* eslint-disable sort-keys-fix/sort-keys-fix , typescript-sort-keys/interface */
import { z } from 'zod';

/**
 * Page selection represents a user-selected text region in a page/document.
 * Used for Ask AI functionality to persist selection context with user messages.
 */
export interface PageSelection {
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

export const PageSelectionSchema = z.object({
  id: z.string(),
  content: z.string(),
  xml: z.string().optional(),
  pageId: z.string(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
});
