'use client';

import { type ReactNode } from 'react';

export const ShareLogoLink = ({ children }: { children: ReactNode }) => (
  <a href={'/'} style={{ color: 'inherit', display: 'flex' }}>
    {children}
  </a>
);

export const ShareHeaderMenu = () => null;
