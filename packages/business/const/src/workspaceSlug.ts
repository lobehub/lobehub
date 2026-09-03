/**
 * Format rules for a workspace slug, mirroring the cloud constants of the same
 * names so the open-source router contract rejects what cloud rejects.
 *
 * Cloud additionally refuses slugs that would shadow a real top-level route
 * (`chat`, `settings`, `api`, …) — that reservation list is a deployment
 * concern and lives only in the cloud overlay, so a slug accepted here can
 * still come back as `invalid-slug` from the server.
 */
export const WORKSPACE_SLUG_MIN = 3;
export const WORKSPACE_SLUG_MAX = 32;

export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Format-only check: lowercase alphanumerics and inner hyphens. */
export const isWorkspaceSlugFormatValid = (slug: string): boolean =>
  WORKSPACE_SLUG_PATTERN.test(slug);
