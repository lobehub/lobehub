'use client';

import { createContext, type FC, type PropsWithChildren, use } from 'react';

import { type InternalLinkReference } from './internalLink';

/**
 * Which entity details this surface can show in a side panel.
 *
 * - `true` — every kind. The conversation, the goal page, the task manager and
 *   the mobile portal all mount `PortalContent`, which renders any view.
 * - a list — only those kinds. Home mounts the acceptance drawer and nothing
 *   else, so anything else must fall back to its own route.
 * - `false` — none. A full-screen reader has no panel to open into.
 */
export type EntityLinkPortalScope = boolean | readonly InternalLinkReference['type'][];

/**
 * Defaults to `true` because that is the behaviour every existing surface
 * already has: a host only declares a scope when it cannot render every detail.
 */
const EntityLinkPortalContext = createContext<EntityLinkPortalScope>(true);

export const EntityLinkHostProvider: FC<PropsWithChildren<{ portal: EntityLinkPortalScope }>> = ({
  children,
  portal,
}) => <EntityLinkPortalContext value={portal}>{children}</EntityLinkPortalContext>;

/**
 * Whether this host can open `referenceType`'s detail in a panel. A `route`
 * link has no detail of its own, so it always resolves by navigation.
 */
export const useEntityLinkPortal = (referenceType: InternalLinkReference['type']): boolean => {
  const scope = use(EntityLinkPortalContext);

  if (referenceType === 'route') return false;
  if (typeof scope === 'boolean') return scope;

  return scope.includes(referenceType);
};
