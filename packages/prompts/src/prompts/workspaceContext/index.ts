import { escapeXmlContent } from '../search/xmlEscape';

export interface WorkspaceContextWorkspace {
  /** URL slug that prefixes every workspace route (`/{slug}/...`). */
  slug: string;
}

export interface WorkspaceContextInfo {
  /** App origin the user is browsing, e.g. `https://app.lobehub.com`. */
  appUrl?: string | null;
  /**
   * The workspace the conversation runs in. Absent for the user's personal
   * space, where routes carry no slug prefix.
   */
  workspace?: WorkspaceContextWorkspace | null;
}

const trimTrailingSlashes = (value: string): string => {
  // Character loop instead of a trailing-anchored regex: the origin is URL input
  // and a trailing-anchored quantifier is polynomial on long runs of '/'.
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
};

/**
 * In-app routes the model may need to link to. Mirrors the SPA router
 * (`sharedMainAreaChildren`) which is mounted both at `/` and `/:workspaceSlug`.
 * Kept deliberately short — only surfaces whose ids the model routinely holds
 * (from tool results). Everything else must come from a tool-returned URL.
 */
const ROUTE_HINTS: [label: string, path: string][] = [
  ['agent chat', '/agent/<agentId>'],
  ['agent task detail', '/agent/<agentId>/task/<T-123>'],
  ['agent document', '/agent/<agentId>/docs/<docId>'],
  ['page (workspace document)', '/page/<documentId>'],
  ['knowledge base', '/resource/library/<knowledgeBaseId>'],
];

/**
 * Where the conversation lives, injected into the system message so the model
 * can write in-app links that actually resolve.
 *
 * Without this the model only knows the product name and guesses URLs from
 * training data (`https://lobehub.com/kb/...`): the wrong host, a route that
 * does not exist, and — inside a team workspace — missing the `/{slug}` prefix,
 * so the link opens the user's personal space instead of the shared resource.
 * Tool results already return workspace-aware URLs; this block closes the gap
 * for links the model composes itself and tells it to prefer tool-returned
 * URLs verbatim.
 *
 * Only the validated slug is injected. The workspace display name is
 * free-form, admin-controlled text and is deliberately kept out of the system
 * prompt: escaping stops tag breakout but not the model following whatever
 * the name says, and link generation never needs it.
 *
 * Returns an empty string when there is nothing to anchor on (no origin and
 * no workspace) so callers can skip injection.
 */
export const workspaceContextPrompt = ({ appUrl, workspace }: WorkspaceContextInfo): string => {
  const origin = appUrl?.trim() ? trimTrailingSlashes(appUrl.trim()) : '';
  const slug = workspace?.slug?.trim();
  if (!origin && !slug) return '';

  const escapedOrigin = escapeXmlContent(origin);
  const escapedSlug = slug ? escapeXmlContent(slug) : '';
  // Every in-app link starts with this: origin + optional `/{slug}` prefix.
  const linkBase = `${escapedOrigin}${escapedSlug ? `/${escapedSlug}` : ''}`;

  const lines: string[] = ['<workspace_context>'];

  if (escapedSlug) {
    lines.push(`  <scope>workspace</scope>`, `  <workspace_slug>${escapedSlug}</workspace_slug>`);
    if (origin) lines.push(`  <app_url>${escapedOrigin}</app_url>`);
    lines.push(`  <link_base>${linkBase}</link_base>`);
    lines.push(
      `  <instruction>You are running inside the LobeHub app${origin ? ` at ${escapedOrigin}` : ''}, in the team workspace identified by the workspace_slug field above. Every in-app link to a workspace resource (agents, tasks, documents, pages, knowledge bases, files, settings) MUST start with the workspace slug prefix "${linkBase}/". A link without the "/${escapedSlug}" prefix opens the user's personal space and will not show workspace content.</instruction>`,
    );
  } else {
    lines.push(
      `  <scope>personal</scope>`,
      `  <app_url>${escapedOrigin}</app_url>`,
      `  <link_base>${linkBase}</link_base>`,
      `  <instruction>You are running inside the LobeHub app at ${escapedOrigin}, in the user's personal space. In-app links start with "${linkBase}/" directly (no workspace prefix).</instruction>`,
    );
  }

  lines.push(
    `  <routes>`,
    ...ROUTE_HINTS.map(([label, path]) => `    ${label}: ${linkBase}${path}`),
    `  </routes>`,
    `  <link_rules>These rules apply only to links into this LobeHub app (agents, tasks, documents, pages, knowledge bases, files, settings). When a tool result already contains such a URL, reuse it verbatim. Compose one yourself only from the routes above with an id you actually hold; never invent hosts, paths, slugs, or ids, and never place in-app resources under the marketing site lobehub.com. Links to other websites, including the LobeHub homepage itself, are not affected.</link_rules>`,
    '</workspace_context>',
  );

  return lines.join('\n');
};
