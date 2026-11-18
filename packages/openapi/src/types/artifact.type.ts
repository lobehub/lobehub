import { WORKSPACE_HTML_ARTIFACT_MAX_FILES } from '@lobechat/html-artifact';
import { z } from 'zod';

import { dateTimeSchema } from './common.type';

/**
 * Publishing an HTML artifact — a self-contained page plus optional sidecar
 * assets — to a public URL. Same pipeline as `lh artifact publish` and the
 * app's Publish button (`market.deployments.publishWorkspaceHtml`).
 */

/** Transport backstop for the entry document; the deployment plan enforces its own quota. */
export const ARTIFACT_HTML_MAX_LENGTH = 5 * 1024 * 1024;

export const PublishArtifactRequestSchema = z.object({
  artifactIdentifier: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe('Stable id of the artifact in your system. Defaults to a fresh one per publish.'),
  deploymentId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Publish a new revision of this existing deployment instead of creating a site.'),
  files: z
    .array(
      z.object({
        content: z.string().min(1).describe('File content, encoded as `encoding` says.'),
        contentType: z.string().min(1).max(255),
        encoding: z.enum(['base64', 'utf8']),
        path: z
          .string()
          .min(1)
          .max(512)
          .describe('Path the entry document references, e.g. `assets/app.js`.'),
      }),
    )
    .max(WORKSPACE_HTML_ARTIFACT_MAX_FILES)
    .optional()
    .describe('Sidecar assets (scripts, styles, images) served next to the page.'),
  html: z
    .string()
    .min(1)
    .max(ARTIFACT_HTML_MAX_LENGTH)
    .describe('The entry HTML document, served at the site root.'),
  slug: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe('Preferred subdomain label; defaults to one derived from `title`.'),
  title: z.string().min(1).max(255).optional(),
});

export type PublishArtifactRequest = z.infer<typeof PublishArtifactRequestSchema>;

export const ArtifactDeploymentSchema = z
  .object({
    id: z.string().describe('Deployment id; pass as `deploymentId` to publish a new revision.'),
    latestRevisionNumber: z.number().int(),
    publicUrl: z.string().describe('Where the page is served. Anyone with the link can open it.'),
    status: z.enum(['active', 'unpublished', 'building', 'failed']),
    subdomainLabel: z.string().nullable(),
    title: z.string().nullable(),
    updatedAt: dateTimeSchema,
  })
  .meta({ id: 'ArtifactDeployment' });

export type ArtifactDeploymentResponse = z.infer<typeof ArtifactDeploymentSchema>;
