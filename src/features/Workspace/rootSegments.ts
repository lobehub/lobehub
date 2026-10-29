/**
 * First path segments that share the URL namespace with `/:workspaceSlug`.
 *
 * `rootSegments.test.ts` derives both sets from the Web, Electron and mobile
 * route tables and fails when a root route is added without updating them.
 * A root missing here is read as a workspace slug: in-app navigation to it
 * keeps the previous workspace scope and its requests 404 (`/goal/:id` did).
 */

/**
 * Roots mirrored under `/:workspaceSlug/...` (children of the workspace route).
 * A few, like `billing`, exist only there.
 */
export const WORKSPACE_MIRRORED_ROOT_SEGMENTS: ReadonlySet<string> = new Set([
  'acceptance',
  'agent',
  'agents',
  'billing',
  'channels',
  'community',
  'dashboard',
  'eval',
  'goal',
  'goals',
  'group',
  'image',
  'memory',
  'page',
  'project',
  'projects',
  'resource',
  'settings',
  'task',
  'tasks',
  'video',
]);

/**
 * Roots outside the SPA route table: Next.js pages, the share micro-app, Cloud
 * business routes, and the retired `/verify` that persisted tabs may still hold.
 */
export const OFF_TABLE_ROOT_SEGMENTS: ReadonlySet<string> = new Set([
  'a',
  'devtools',
  'embed',
  'invite',
  'share',
  'subscription',
  'verify',
  'waitlist',
]);

/** Every root that is never a workspace slug. */
export const RESERVED_ROOT_SEGMENTS: ReadonlySet<string> = new Set([
  ...WORKSPACE_MIRRORED_ROOT_SEGMENTS,
  ...OFF_TABLE_ROOT_SEGMENTS,
  // Personal-only roots in the SPA route table.
  'apps',
  'desktop-onboarding',
  'me',
  'onboarding',
  'verify-im',
]);

const FIRST_SEGMENT_REGEX = /^\/([^/?#]+)/;

export const parseRootSegment = (pathname: string): string | null =>
  FIRST_SEGMENT_REGEX.exec(pathname)?.[1] ?? null;
