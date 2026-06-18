'use client';

import { Github } from '@lobehub/icons';
import { Mail } from 'lucide-react';
import { memo } from 'react';

import { type MarkdownElementProps } from '../../type';
import { type LobeLinkKind } from '../parse';
import FaviconIcon from './FaviconIcon';
import LinearIcon from './LinearIcon';
import LinkChip from './LinkChip';

const ICON_SIZE = 15;

interface LobeLinkProperties {
  linkDomain?: string;
  linkHref?: string;
  linkKind?: LobeLinkKind;
  linkLabel?: string;
}

const Render = memo<MarkdownElementProps<LobeLinkProperties>>(({ node }) => {
  const { linkHref, linkKind, linkLabel, linkDomain } = node?.properties || {};

  const label = linkLabel || linkHref || '';

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
