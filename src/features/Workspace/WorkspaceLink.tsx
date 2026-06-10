'use client';

import { type AnchorHTMLAttributes, type Ref } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';

import { buildWorkspaceAwarePath } from './workspaceAwarePath';

export interface WorkspaceLinkProps extends Omit<LinkProps, 'to' | 'ref'> {
  /** When true, do not apply the workspace prefix. */
  escape?: boolean;
  /**
   * Widened to `HTMLElement` so existing sidebar callsites passing a
   * `useState<HTMLElement | null>` setter work without changes.
   */
  ref?: Ref<HTMLElement>;
  /** Same semantics as `<Link to>` but auto-prefixed with the active workspace slug. */
  to: string;
}

const WorkspaceLink = ({ ref, to, escape, ...rest }: WorkspaceLinkProps) => {
  const activeSlug = useActiveWorkspaceSlug();
  const target = buildWorkspaceAwarePath(to, activeSlug, { escape });
  return (
    <Link
      ref={ref as Ref<HTMLAnchorElement>}
      to={target}
      {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
    />
  );
};

WorkspaceLink.displayName = 'WorkspaceLink';

export default WorkspaceLink;
