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

/**
 * How a host that covers a portal-capable page gets out of the way. Set only by
 * overlays (the deliverable reader): closing them uncovers a page whose side
 * panel can show the detail, for destinations that have no route on every
 * platform.
 */
const EntityLinkDismissContext = createContext<(() => void) | undefined>(undefined);

export const EntityLinkHostProvider: FC<
  PropsWithChildren<{ onDismiss?: () => void; portal: EntityLinkPortalScope }>
> = ({ children, onDismiss, portal }) => (
  <EntityLinkPortalContext value={portal}>
    <EntityLinkDismissContext value={onDismiss}>{children}</EntityLinkDismissContext>
  </EntityLinkPortalContext>
);

/** The covering host's close callback, when it has one — see {@link EntityLinkHostProvider}. */
export const useEntityLinkHostDismiss = (): (() => void) | undefined =>
  use(EntityLinkDismissContext);

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
