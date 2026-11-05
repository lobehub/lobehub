import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useAcceptanceOrigin } from '@/features/Acceptance/origin';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

import type { InternalLinkReference } from '../internalLink';

/**
 * Absolute web URL of an acceptance link, for opening it in the browser
 * instead of the side panel. `undefined` for other entities, and without an
 * origin: a relative URL is something the desktop system browser cannot resolve.
 */
export const useAcceptanceBrowserUrl = (reference: InternalLinkReference): string | undefined => {
  const appOrigin = useAcceptanceOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  if (reference.type !== 'acceptance' || !appOrigin) return;

  // A workspace-prefixed path is already scoped; an unprefixed one is scoped
  // to the active workspace, the same way a click on the link resolves it.
  const pathname = reference.workspaceSlug
    ? reference.pathname
    : buildWorkspaceAwarePath(reference.pathname, activeWorkspaceSlug);

  return `${appOrigin}${pathname}`;
};
