import { z } from 'zod';

export const ContextSelectionFormatSchema = z.enum(['markdown', 'text', 'xml']);

export const ContextSelectionLineRangeSchema = z.object({
  endLine: z.number().optional(),
  startLine: z.number(),
});

export const ContextSelectionBaseSchema = z.object({
  content: z.string(),
  format: ContextSelectionFormatSchema.optional(),
  id: z.string(),
  lineRange: ContextSelectionLineRangeSchema.optional(),
  preview: z.string().optional(),
  title: z.string().optional(),
});

export interface ContextSelectionLineRange {
  endLine?: number;
  startLine: number;
}

export interface ContextSelectionBase {
  content: string;
  /**
   * Format of the content. Defaults to text.
   */
  format?: 'markdown' | 'text' | 'xml';
  id: string;
  lineRange?: ContextSelectionLineRange;
  /**
   * Optional short preview for displaying in UI.
   */
  preview?: string;
  title?: string;
}

export const PageContextSelectionSchema = ContextSelectionBaseSchema.extend({
  anchor: z
    .object({
      endNodeId: z.string(),
      endOffset: z.number(),
      startNodeId: z.string(),
      startOffset: z.number(),
    })
    .optional(),
  pageId: z.string(),
  source: z.literal('page'),
  xml: z.string().optional(),
});

export interface PageContextSelection extends ContextSelectionBase {
  anchor?: {
    endNodeId: string;
    endOffset: number;
    startNodeId: string;
    startOffset: number;
  };
  pageId: string;
  source: 'page';
  xml?: string;
}

export const CodeContextSelectionSchema = ContextSelectionBaseSchema.extend({
  filePath: z.string(),
  language: z.string().optional(),
  side: z.enum(['additions', 'context', 'deletions']).optional(),
  source: z.literal('code'),
  workingDirectory: z.string().optional(),
});

export interface CodeContextSelection extends ContextSelectionBase {
  filePath: string;
  language?: string;
  side?: 'additions' | 'context' | 'deletions';
  source: 'code';
  workingDirectory?: string;
}

export const TextContextSelectionSchema = ContextSelectionBaseSchema.extend({
  source: z.literal('text'),
});

export interface TextContextSelection extends ContextSelectionBase {
  source: 'text';
}

export const ContextSelectionSchema = z.discriminatedUnion('source', [
  PageContextSelectionSchema,
  CodeContextSelectionSchema,
  TextContextSelectionSchema,
]);

export type ContextSelection = PageContextSelection | CodeContextSelection | TextContextSelection;
