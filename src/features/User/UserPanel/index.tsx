'use client';

import { Popover } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type PropsWithChildren } from 'react';
import { memo, Suspense, useState } from 'react';

import { isDesktop } from '@/const/version';

import PanelContent from './PanelContent';
import PanelContentSkeleton from './PanelContentSkeleton';

const styles = createStaticStyles(({ css }) => {
  return {
    popover: css`
      inset-block-start: ${isDesktop ? 32 : 8}px !important;
      inset-inline-start: 8px !important;
      border-radius: 10px;
    `,
    popoverContent: css`
      padding: 0;
    `,
  };
});

const UserPanel = memo<PropsWithChildren>(({ children }) => {
  const [open, setOpen] = useState(false);

  return (
    <Suspense fallback={children}>
      <Popover
        arrow={false}
        open={open}
        placement="topLeft"
        trigger="click"
        classNames={{
          root: styles.popover,
          content: styles.popoverContent,
        }}
        content={
          <Suspense fallback={<PanelContentSkeleton />}>
            <PanelContent closePopover={() => setOpen(false)} />
          </Suspense>
        }
        onOpenChange={setOpen}
      >
        {children}
      </Popover>
    </Suspense>
  );
});

UserPanel.displayName = 'UserPanel';

export default UserPanel;
