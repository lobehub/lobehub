'use client';

import { type ReactNode } from 'react';

export const ShareLogoLink = ({ children }: { children: ReactNode }) => (
  <a href={'/'} style={{ color: 'inherit', display: 'flex' }}>
    {children}
  </a>
);

export const ShareHeaderMenu = () => null;

// Cloud can supply native-app entry and compact actions without replacing the share layout.
export interface ShareHeaderActionsProps {
  actions?: ReactNode;
  compactActions?: { key: string; label: string; onClick: () => void }[];
  copyLink?: ReactNode;
}

export const ShareHeaderActions = ({ actions, copyLink }: ShareHeaderActionsProps) => (
  <>
    {actions}
    {copyLink}
    <ShareHeaderMenu />
  </>
);
