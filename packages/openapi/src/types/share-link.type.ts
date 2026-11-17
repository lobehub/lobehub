import { z } from 'zod';

/**
 * Public share links: one read-only URL per topic, page, agent or published
 * artifact that anyone holding it can open.
 */
export const SHARE_LINK_RESOURCE_TYPES = ['topic', 'page', 'agent', 'artifact'] as const;
export type ShareLinkResourceType = (typeof SHARE_LINK_RESOURCE_TYPES)[number];

// ==================== Path Schemas ====================

export const ShareLinkParamSchema = z.object({
  resourceId: z
    .string()
    .min(1)
    .describe(
      'Topic, page (document), or agent id; for an artifact, the published deployment id returned when it was shared',
    ),
  resourceType: z.enum(SHARE_LINK_RESOURCE_TYPES),
});
export type ShareLinkParam = z.infer<typeof ShareLinkParamSchema>;

// ==================== Request Schemas ====================

const ResourceShareRequestSchema = z
  .object({
    resourceId: z.string().min(1).describe('Id of the topic, page (document) or agent'),
    resourceType: z.enum(['topic', 'page', 'agent']),
  })
  .strict();

const ArtifactShareRequestSchema = z
  .object({
    artifactIdentifier: z.string().min(1).describe('Identifier of the artifact in the message'),
    messageId: z.string().min(1).describe('Message that carries the artifact'),
    resourceType: z.literal('artifact'),
    slug: z.string().min(1).max(64).optional().describe('Preferred subdomain label'),
    topicId: z.string().min(1).describe('Topic the message belongs to'),
  })
  .strict();

export const CreateShareLinkRequestSchema = z.discriminatedUnion('resourceType', [
  ResourceShareRequestSchema,
  ArtifactShareRequestSchema,
]);
export type CreateShareLinkRequest = z.infer<typeof CreateShareLinkRequestSchema>;

// ==================== Response Schemas ====================

export const ShareLinkSchema = z
  .object({
    enabled: z.boolean().describe('Whether anyone holding the URL can open it right now'),
    resourceId: z.string(),
    resourceType: z.enum(SHARE_LINK_RESOURCE_TYPES),
    shareId: z
      .string()
      .nullable()
      .describe('Id of the share record; `null` when the resource was never shared'),
    url: z.string().nullable().describe('Public URL; `null` when the resource was never shared'),
    viewCount: z
      .number()
      .int()
      .min(0)
      .nullable()
      .describe('Page views of the link, when this resource type counts them'),
  })
  .strict()
  .meta({ id: 'ShareLink' });
export type ShareLink = z.infer<typeof ShareLinkSchema>;
