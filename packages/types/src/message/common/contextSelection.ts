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

export const ContextSelectionPageRangeSchema = z.object({
  endPage: z.number().optional(),
  startPage: z.number(),
});

/** 1-based page numbers of a paged document, such as a PDF. */
export interface ContextSelectionPageRange {
  endPage?: number;
  startPage: number;
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

/** A DOM element picked from the in-app browser page. */
export const ElementContextSelectionSchema = ContextSelectionBaseSchema.extend({
  element: z.object({
    pageTitle: z.string().optional(),
    selector: z.string(),
    tag: z.string(),
    /** Small cropped screenshot of the picked element (data URL). */
    thumbnailUrl: z.string().optional(),
    url: z.string().optional(),
  }),
  source: z.literal('element'),
});

export interface ElementContextSelection extends ContextSelectionBase {
  element: {
    pageTitle?: string;
    selector: string;
    tag: string;
    thumbnailUrl?: string;
    url?: string;
  };
  source: 'element';
}

/**
 * Text selected in a stored file's preview, such as the text layer of a PDF.
 * `fileId` lets the agent go back to the whole file; `title` carries its name.
 */
export const FileContextSelectionSchema = ContextSelectionBaseSchema.extend({
  fileId: z.string(),
  pageRange: ContextSelectionPageRangeSchema.optional(),
  source: z.literal('file'),
});

export interface FileContextSelection extends ContextSelectionBase {
  fileId: string;
  pageRange?: ContextSelectionPageRange;
  source: 'file';
}

export const McpAppContextSelectionSchema = ContextSelectionBaseSchema.extend({
  identifier: z.string(),
  source: z.literal('mcpApp'),
});
export interface McpAppContextSelection extends ContextSelectionBase {
  identifier: string;
  source: 'mcpApp';
}

export const ContextSelectionSchema = z.discriminatedUnion('source', [
  PageContextSelectionSchema,
  CodeContextSelectionSchema,
  TextContextSelectionSchema,
  ElementContextSelectionSchema,
  FileContextSelectionSchema,
  McpAppContextSelectionSchema,
]);

export type ContextSelection =
  | PageContextSelection
  | CodeContextSelection
  | TextContextSelection
  | ElementContextSelection
  | FileContextSelection
  | McpAppContextSelection;
