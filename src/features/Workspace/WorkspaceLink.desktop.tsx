'use client';

import { type AnchorHTMLAttributes, type MouseEvent, type Ref } from 'react';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';

import { useWorkspaceAwareNavigate } from './useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from './workspaceAwarePath';
import type { WorkspaceLinkProps } from './WorkspaceLink';

const WorkspaceLink = ({ ref, to, escape, onClick, target, ...rest }: WorkspaceLinkProps) => {
  const activeSlug = useActiveWorkspaceSlug();
  const navigate = useWorkspaceAwareNavigate();
  const resolved = buildWorkspaceAwarePath(to, activeSlug, { escape });

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (target && target !== '_self') return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    event.preventDefault();
    navigate(resolved, { escape: true });
  };

  return (
    <a
      href={resolved}
      ref={ref as Ref<HTMLAnchorElement>}
      target={target}
      onClick={handleClick}
      {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
    />
  );
};

WorkspaceLink.displayName = 'WorkspaceLink';

export default WorkspaceLink;
