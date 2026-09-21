'use client';

import { Drawer } from '@lobehub/ui/base-ui';
import { useResponsive } from 'antd-style';
import type { ComponentProps } from 'react';

/** Keep each reading level full-width on phones, with a persistent exit. */
export const AcceptanceDrawer = ({
  noHeader,
  push,
  styles,
  width,
  ...props
}: ComponentProps<typeof Drawer>) => {
  const { md = true } = useResponsive();
  const mobile = !md;

  return (
    <Drawer
      {...props}
      noHeader={mobile ? false : noHeader}
      push={mobile ? false : push}
      width={mobile ? '100%' : width}
      styles={{
        ...styles,
        bodyContent: {
          display: 'flex',
          flexDirection: 'column',
          ...styles?.bodyContent,
        },
        ...(mobile && {
          close: { ...styles?.close, height: 44, width: 44 },
          header: {
            ...styles?.header,
            paddingBlock: 'max(4px, env(safe-area-inset-top)) 4px',
          },
          panel: {
            ...styles?.panel,
            paddingBottom: 'env(safe-area-inset-bottom)',
          },
        }),
      }}
    />
  );
};
