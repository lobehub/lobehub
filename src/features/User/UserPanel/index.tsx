'use client';

import { createStaticStyles, Popover } from '@lobehub/ui';
import { type PropsWithChildren } from 'react';
import { memo, Suspense, useState } from 'react';

import { isDesktop } from '@/const/version';
import { useCloseOnNavigate } from '@/hooks/useCloseOnNavigate';

import PanelContent from './PanelContent';
import PanelContentSkeleton from './PanelContentSkeleton';
import UpgradeBadge from './UpgradeBadge';
import { useNewVersion } from './useNewVersion';

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
  const hasNewVersion = useNewVersion();
  const [open, setOpen] = useState(false);
  // Panel entries, including business slots, may navigate without a close callback.
  const popoverKey = useCloseOnNavigate(open, () => setOpen(false));

  return (
    <Suspense fallback={children}>
      <UpgradeBadge showBadge={hasNewVersion}>
        <Popover
          arrow={false}
          key={popoverKey}
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
      </UpgradeBadge>
    </Suspense>
  );
});

UserPanel.displayName = 'UserPanel';

export default UserPanel;
