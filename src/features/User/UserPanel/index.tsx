'use client';

import { Popover } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type PropsWithChildren, Suspense, memo, useState } from 'react';

import { isDesktop } from '@/const/version';

import PanelContent from './PanelContent';
import UpgradeBadge from './UpgradeBadge';
import { useNewVersion } from './useNewVersion';

const styles = createStaticStyles(({ css }) => {
  return {
    popover: css`
      inset-block-start: ${isDesktop ? 32 : 8}px !important;
      inset-inline-start: 8px !important;
    `,
  };
});

const UserPanel = memo<PropsWithChildren>(({ children }) => {
  const hasNewVersion = useNewVersion();
  const [open, setOpen] = useState(false);

  return (
    <Suspense fallback={children}>
      <UpgradeBadge showBadge={hasNewVersion}>
        <Popover
          arrow={false}
          classNames={{
            root: styles.popover,
          }}
          content={<PanelContent closePopover={() => setOpen(false)} />}
          onOpenChange={setOpen}
          open={open}
          placement={'topRight'}
          styles={{
            container: { borderRadius: 10, padding: 0 },
          }}
          trigger={['click']}
        >
          {children}
        </Popover>
      </UpgradeBadge>
    </Suspense>
  );
});

UserPanel.displayName = 'UserPanel';

export default UserPanel;
