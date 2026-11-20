import { type ReactNode } from 'react';

import { type LobeLinkKind } from './parse';

/** Properties the rehype pass stamps onto a rewritten `<lobeLink>` element. */
export interface EntityLinkProperties {
  linkDomain?: string;
  linkHref?: string;
  linkKind?: LobeLinkKind;
  linkLabel?: string;
}

/**
 * Props the markdown element pipeline hands the entity-link renderer.
 *
 * Every field is optional on purpose: the conversation plugin registry passes
 * `id` / `tagName` / `type`, a bare reading surface passes only `node`, and the
 * looser shape is what lets both mount this one element.
 */
export interface EntityLinkElementProps {
  children?: ReactNode;
  id?: string;
  node?: { properties?: EntityLinkProperties };
  tagName?: string;
  type?: string;
}
