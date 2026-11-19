import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema } from './common.type';

/**
 * Cloud sandboxes on the public REST API. A sandbox is an environment
 * instance: a directory on the caller's network drive, built from a code
 * environment, that commands run in. Every rule (which drive, who may see or
 * write a directory, the build) is the `sandboxStorage` tRPC router's, called
 * server-side; commands run through the same sandbox service agent runs use.
 */

const uuid = z.string().uuid();

export const SandboxIdParamSchema = z.object({
  id: uuid.describe('Sandbox (environment instance) id.'),
});

/** A path inside the sandbox directory: relative, and never climbing out of it. */
const sandboxRelativePath = z
  .string()
  .max(1024)
  .refine(
    (value) => !value.startsWith('/') && !value.split('/').some((segment) => segment === '..'),
    'Path must be relative to the sandbox directory and may not contain `..`',
  );

export const SandboxSchema = z
  .object({
    buildError: z.string().nullable().describe('Why the last build failed; null otherwise.'),
    createdAt: dateTimeSchema,
    drive: z
      .enum(['personal', 'public'])
      .nullable()
      .describe('Which of the caller’s drives the directory is on.'),
    environmentId: uuid.describe('Code environment the sandbox was built from.'),
    id: uuid,
    name: z.string(),
    status: z
      .enum(['pending', 'ready', 'stopped', 'error'])
      .describe('`pending` until its first build settles; commands need `ready`.'),
    workingDirectory: z.string().describe('The sandbox’s directory, relative to the drive root.'),
  })
  .meta({ id: 'Sandbox' });

export const SandboxListQuerySchema = CursorPaginationQuerySchema.extend({
  environmentId: uuid.optional().describe('Only sandboxes built from this environment.'),
});

export const SandboxListResponseSchema = paginatedListSchema(SandboxSchema, { total: true });

export const CreateSandboxRequestSchema = z.object({
  environmentId: uuid.describe('Code environment to build the sandbox from; must be your own.'),
  name: z.string().trim().min(1).max(255).optional().describe('Display name.'),
  workingDirectory: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^/]+$/, 'A sandbox directory sits at the root of the drive')
    .refine((value) => value !== '..' && value !== '.', 'Invalid directory name')
    .optional()
    .describe(
      'Directory to create at the drive root. Derived from the environment name when omitted.',
    ),
});

export const SandboxFileListQuerySchema = z.object({
  path: sandboxRelativePath
    .default('')
    .describe('Directory inside the sandbox; empty for its root.'),
  recursive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional()
    .describe('List everything under the directory.'),
});

const SandboxFileEntrySchema = z.object({
  isDirectory: z.boolean(),
  modifiedAt: z.string().nullable(),
  name: z.string(),
  path: z.string().describe('Relative to the sandbox directory.'),
  size: z.number().nullable(),
});

export const SandboxFileListSchema = z.object({
  entries: z.array(SandboxFileEntrySchema),
  truncated: z.boolean(),
});

export const SandboxFileContentQuerySchema = z.object({
  path: sandboxRelativePath
    .refine(Boolean, 'Path is required')
    .describe('File inside the sandbox.'),
});

export const SandboxFileContentSchema = z.object({
  content: z.string(),
  mimeType: z.string().nullable(),
  path: z.string().describe('Relative to the sandbox directory.'),
});

export const WriteSandboxFileRequestSchema = z.object({
  content: z
    .string()
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= 1024 * 1024,
      'File content exceeds 1 MiB',
    )
    .describe('Text content (≤ 1 MiB UTF-8), replacing the file; parents are created.'),
  path: sandboxRelativePath
    .refine(Boolean, 'Path is required')
    .describe('File inside the sandbox.'),
});

export const SandboxFileWriteResultSchema = z.object({
  path: z.string(),
  written: z.literal(true),
});

export const RunSandboxCommandRequestSchema = z.object({
  command: z
    .string()
    .trim()
    .min(1)
    .max(32_000)
    .describe('Shell command, run in the sandbox directory.'),
  timeoutMs: z.number().int().min(1000).max(600_000).default(60_000),
});

export const SandboxCommandResultSchema = z.object({
  exitCode: z.number().int(),
  output: z.string().describe('Standard output.'),
  stderr: z.string().nullable(),
  success: z.boolean(),
});

export type SandboxResponse = z.infer<typeof SandboxSchema>;
export type SandboxListQuery = z.infer<typeof SandboxListQuerySchema>;
export type CreateSandboxRequest = z.infer<typeof CreateSandboxRequestSchema>;
export type SandboxFileListQuery = z.infer<typeof SandboxFileListQuerySchema>;
export type SandboxFileListResponse = z.infer<typeof SandboxFileListSchema>;
export type SandboxFileContentQuery = z.infer<typeof SandboxFileContentQuerySchema>;
export type SandboxFileContentResponse = z.infer<typeof SandboxFileContentSchema>;
export type WriteSandboxFileRequest = z.infer<typeof WriteSandboxFileRequestSchema>;
export type RunSandboxCommandRequest = z.infer<typeof RunSandboxCommandRequestSchema>;
export type SandboxCommandResponse = z.infer<typeof SandboxCommandResultSchema>;
