import { z } from 'zod';

// ==================== Exports ====================

export const EXPORT_FORMATS = ['json', 'pdf'] as const;

export const ExportFormatSchema = z
  .enum(EXPORT_FORMATS)
  .describe(
    '`json` — the whole account (or, with `X-Workspace-Id`, workspace) as a re-importable dump; `pdf` — the given Markdown rendered as a PDF.',
  );

export const CreateExportRequestSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('json') }),
  z.object({
    content: z.string().min(1).describe('Markdown to render, e.g. a topic transcript'),
    format: z.literal('pdf'),
    title: z.string().max(200).optional().describe('Heading of the first page and the file name'),
  }),
]);

export type CreateExportRequest = z.infer<typeof CreateExportRequestSchema>;

export const ExportIdParamSchema = z.object({
  id: z
    .string()
    .regex(/^exp_[\w-]{8,64}$/, 'Invalid export id')
    .describe('Export id returned by `POST /exports`'),
});

export type ExportIdParam = z.infer<typeof ExportIdParamSchema>;

export const ExportSchema = z.object({
  downloadUrl: z
    .string()
    .describe('Signed URL that downloads the file. Fetch the export again for a fresh one.'),
  expiresAt: z.string().describe('When `downloadUrl` stops working (ISO 8601)'),
  filename: z.string().describe('Suggested file name'),
  format: ExportFormatSchema,
  id: z.string().describe('Export id, bound to the caller and the workspace it was made in'),
  size: z.number().int().nonnegative().describe('File size in bytes'),
  status: z
    .enum(['completed'])
    .describe('Always `completed` today; reserved for exports that finish in the background.'),
});

export type ExportResult = z.infer<typeof ExportSchema>;

// ==================== Imports ====================

const RowSchema = z
  .record(z.string(), z.unknown())
  .describe('One database row as it appears in a `json` export');

const LegacyRowsSchema = z.array(RowSchema).optional();

export const CreateImportRequestSchema = z.discriminatedUnion('source', [
  z.object({
    data: z
      .record(z.string(), z.array(RowSchema))
      .describe('Table name → rows: the `data` field of a `json` export'),
    mode: z
      .enum(['pglite', 'postgres'])
      .default('postgres')
      .describe('Database the dump came from'),
    schemaHash: z.string().min(1).describe('The `schemaHash` field of a `json` export'),
    source: z.literal('export'),
  }),
  z.object({
    data: z.object({
      messages: LegacyRowsSchema,
      sessionGroups: LegacyRowsSchema,
      sessions: LegacyRowsSchema,
      topics: LegacyRowsSchema,
      version: z.number().int(),
    }),
    source: z.literal('legacy'),
  }),
  z.object({
    fileId: z
      .string()
      .min(1)
      .describe('An uploaded file of yours holding a `json` export (or a legacy config)'),
    source: z.literal('file'),
  }),
]);

export type CreateImportRequest = z.infer<typeof CreateImportRequestSchema>;

export const ImportTableResultSchema = z.object({
  added: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  skips: z.number().int().nonnegative().describe('Rows that already existed and were kept'),
  updated: z.number().int().nonnegative().optional(),
});

export const ImportResultSchema = z.object({
  results: z
    .record(z.string(), ImportTableResultSchema)
    .describe('Per table (or legacy collection): how many rows were added, skipped or failed'),
});

export type ImportResult = z.infer<typeof ImportResultSchema>;
