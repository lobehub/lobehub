'use client';

import { Github } from '@lobehub/icons';
import { Mail } from 'lucide-react';
import { memo } from 'react';

import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { parseInternalLink } from '../internalLink';
import { type EntityLinkElementProps, type EntityLinkProperties } from '../types';
import FaviconIcon from './FaviconIcon';
import { InternalEntityLink } from './InternalEntityLink';
import LinearIcon from './LinearIcon';
import LinkChip from './LinkChip';

const ICON_SIZE = 15;

const Render = memo<EntityLinkElementProps>(({ node }) => {
  const properties: EntityLinkProperties = node?.properties ?? {};
  const { linkHref, linkKind, linkLabel, linkDomain } = properties;
  const showIcon = useUserStore(userGeneralSettingsSelectors.enableMessageLinkIcon);
  const workspaces = useWorkspaces();

  const label = linkLabel || linkHref || '';
  const internalReference = parseInternalLink(
    linkHref,
    typeof window === 'undefined' ? undefined : window.location.origin,
    workspaces.map((workspace) => workspace.slug),
  );

  if (linkHref && internalReference) {
    return <InternalEntityLink href={linkHref} label={label} reference={internalReference} />;
  }

  if (!showIcon) {
    return <LinkChip href={linkHref} label={label} />;
  }

  if (linkKind === 'github') {
    return <LinkChip href={linkHref} icon={<Github size={ICON_SIZE} />} label={label} />;
  }

  if (linkKind === 'linear') {
    return <LinkChip href={linkHref} icon={<LinearIcon size={ICON_SIZE} />} label={label} />;
  }

  if (linkKind === 'email') {
    return <LinkChip href={linkHref} icon={<Mail size={ICON_SIZE} />} label={label} />;
  }

  return (
    <LinkChip
      href={linkHref}
      icon={<FaviconIcon domain={linkDomain || ''} size={ICON_SIZE} />}
      label={label}
    />
  );
});

Render.displayName = 'LobeLinkRender';

export default Render;
