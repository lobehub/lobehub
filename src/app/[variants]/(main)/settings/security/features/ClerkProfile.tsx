'use client';

import { UserProfile } from '@clerk/nextjs';
import { type ElementsConfig } from '@clerk/types';
import { createStaticStyles, responsive } from 'antd-style';
import { memo } from 'react';

export const styles = createStaticStyles(
  ({ css, cssVar }) =>
    ({
      cardBox: css`
        width: 100%;
        min-width: 100%;
        background: transparent;
      `,
      footer: css`
        display: none !important;
      `,
      headerTitle: css`
        ${responsive.sm} {
          margin: 0;
          padding: 16px;

          font-size: 14px;
          font-weight: 400;
          line-height: 24px;

          opacity: 0.5;
        }
      `,
      navbar: css`
        display: none !important;
      `,
      navbarMobileMenuRow: css`
        display: none !important;
      `,
      pageScrollBox: css`
        padding: 0;
      `,
      profileSection: css`
        ${responsive.sm} {
          padding-inline: 16px;
          background: ${cssVar.colorBgContainer};
        }
      `,
      rootBox: css`
        width: 100%;
        height: 100%;
      `,
      scrollBox: css`
        background: transparent !important;
      `,
    }) as Partial<Record<keyof ElementsConfig, any>>,
);

const Client = memo(() => {
  return (
    <UserProfile
      appearance={{
        elements: styles,
      }}
      path={'/profile'}
    />
  );
});

export default Client;
