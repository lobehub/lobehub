import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema } from './common.type';

// ==================== Shared ====================

export const SkillSourceSchema = z
  .enum(['builtin', 'market', 'user'])
  .describe(
    '`builtin` ships with LobeHub, `market` came from the marketplace, `user` was written or imported by a user.',
  );

const SkillAuthorSchema = z
  .union([z.string(), z.object({ name: z.string(), url: z.string().optional() }).strict()])
  .describe('A name, or a `{ name, url }` object (marketplace skills).');

/**
 * The SKILL.md manifest as the API exposes it: the documented fields only.
 * Unknown front-matter keys a skill carries are not part of the public shape.
 */
export const SkillManifestSchema = z
  .object({
    author: SkillAuthorSchema.optional(),
    description: z.string(),
    license: z.string().optional(),
    name: z.string(),
    permissions: z.array(z.string()).optional(),
    repository: z.string().optional(),
    sourceUrl: z.string().optional(),
    version: z.string().optional(),
  })
  .strict()
  .meta({ id: 'SkillManifest' });

// ==================== Response Schemas ====================

const skillSummaryShape = {
  createdAt: dateTimeSchema,
  description: z.string().nullable(),
  id: z.string(),
  identifier: z.string().describe('Stable identifier an agent enables the skill by.'),
  manifest: SkillManifestSchema,
  name: z.string(),
  source: SkillSourceSchema,
  updatedAt: dateTimeSchema,
};

/** A skill as list endpoints return it: no body, no resources. */
export const SkillSummarySchema = z.object(skillSummaryShape).strict().meta({ id: 'SkillSummary' });

export const SkillResourceSchema = z
  .object({
    path: z.string().describe('Virtual path inside the skill package, e.g. `scripts/run.py`.'),
    size: z.number().int().min(0).describe('Size in bytes.'),
  })
  .strict()
  .meta({ id: 'SkillResource' });

/** A skill with its SKILL.md body and the resource files it ships. */
export const SkillSchema = z
  .object({
    ...skillSummaryShape,
    content: z.string().nullable().describe('The SKILL.md body (Markdown).'),
    resources: z.array(SkillResourceSchema),
  })
  .strict()
  .meta({ id: 'Skill' });

export const SkillResourceListSchema = z.object({ items: z.array(SkillResourceSchema) }).strict();

export const SkillListSchema = paginatedListSchema(SkillSummarySchema, { total: true });

export const SkillImportResultSchema = z
  .object({
    skill: SkillSchema,
    status: z
      .enum(['created', 'updated', 'unchanged'])
      .describe(
        '`updated` / `unchanged` when a skill with the same identifier was already installed.',
      ),
  })
  .strict()
  .meta({ id: 'SkillImportResult' });

export const SkillResourceContentSchema = z
  .object({
    content: z.string().describe('The file content: text as-is, binary files base64-encoded.'),
    encoding: z.enum(['utf8', 'base64']),
    fileType: z.string().describe('MIME type inferred from the path.'),
    path: z.string(),
    size: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'SkillResourceContent' });

// ==================== Request Schemas ====================

export const SkillIdParamSchema = z.object({ id: z.string().min(1) });

export const SkillListQuerySchema = z.object({
  ...CursorPaginationQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe('Case-insensitive match on the skill name or description.'),
  source: SkillSourceSchema.optional(),
});

export const CreateSkillRequestSchema = z
  .object({
    content: z.string().max(200_000).describe('The SKILL.md body (Markdown).'),
    description: z.string().trim().min(1).max(2000),
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional()
      .describe('Defaults to one derived from `name`.'),
    name: z.string().trim().min(1).max(255),
  })
  .strict();

export const UpdateSkillRequestSchema = z
  .object({
    content: z.string().max(200_000).optional(),
    manifest: SkillManifestSchema.partial()
      .optional()
      .describe('Fields to change; `name` and `description` also rename the skill.'),
  })
  .strict()
  .refine((value) => value.content !== undefined || value.manifest !== undefined, {
    message: 'At least one field must be provided',
  });

export const ImportSkillRequestSchema = z
  .discriminatedUnion('source', [
    z
      .object({
        branch: z.string().trim().min(1).max(255).optional(),
        gitUrl: z.url().describe('GitHub repository or tree URL of the skill directory.'),
        source: z.literal('github'),
      })
      .strict(),
    z
      .object({
        source: z.literal('url'),
        url: z.url().describe('URL of a SKILL.md file or a skill ZIP package.'),
      })
      .strict(),
    z
      .object({
        source: z.literal('zip'),
        zipFileId: z.string().min(1).describe('Id of a ZIP file uploaded with `POST /files`.'),
      })
      .strict(),
    z
      .object({
        identifier: z.string().trim().min(1).max(255).describe('Marketplace skill identifier.'),
        source: z.literal('market'),
      })
      .strict(),
  ])
  .meta({ id: 'ImportSkillRequest' });

export const SkillResourceQuerySchema = z.object({
  path: z.string().min(1).max(1024).describe('Resource path as listed in `resources`.'),
});

export type CreateSkillRequest = z.infer<typeof CreateSkillRequestSchema>;
export type ImportSkillRequest = z.infer<typeof ImportSkillRequestSchema>;
export type SkillListQuery = z.infer<typeof SkillListQuerySchema>;
export type SkillResponse = z.infer<typeof SkillSchema>;
export type SkillSummaryResponse = z.infer<typeof SkillSummarySchema>;
export type UpdateSkillRequest = z.infer<typeof UpdateSkillRequestSchema>;
