'use client';

import { Popover } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type PropsWithChildren } from 'react';
import { memo, Suspense, useState } from 'react';

import { isDesktop } from '@/const/version';
import { useCloseOnNavigate } from '@/hooks/useCloseOnNavigate';

import PanelContent from './PanelContent';
import PanelContentSkeleton from './PanelContentSkeleton';
import UpgradeBadge from './UpgradeBadge';
import { useNewVersion } from './useNewVersion';

const styles = stylex.create({
  popoverContent: { padding: 0 },
  popoverDesktop: {
    insetBlockStart: '32px !important',
    insetInlineStart: '8px !important',
    borderRadius: '10px',
  },
  popoverWeb: {
    insetBlockStart: '8px !important',
    insetInlineStart: '8px !important',
    borderRadius: '10px',
  },
});

const popoverClassName = stylex.props(
  isDesktop ? styles.popoverDesktop : styles.popoverWeb,
).className;

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
            root: popoverClassName,
            content: stylex.props(styles.popoverContent).className,
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
