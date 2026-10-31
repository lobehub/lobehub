import { ActionIcon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { X } from 'lucide-react';
import type { MouseEvent, MouseEventHandler, ReactNode } from 'react';
import { useCallback } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import moduleStyles from './InputBanner.module.css';

const styles = stylex.create({
  banner: {
    position: 'relative',
    zIndex: 0,
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: 0,
    marginBlockStart: '-44px',
    marginBlockEnd: '-6px',
    paddingBlockStart: '42px',
    paddingBlockEnd: '10px',
    paddingInlineStart: '16px',
    paddingInlineEnd: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillSecondary,
    borderRadius: '20px',
    backgroundColor: `color-mix(in srgb, ${cssVar.colorFillQuaternary} 50%, ${cssVar.colorBgContainer})`,
    backgroundImage: 'none',
  },
  clickable: {
    cursor: 'pointer',
  },
});

interface InputBannerProps {
  children: ReactNode;
  dismissId: string;
  dismissTitle: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  testId: string;
}

export const InputBanner = ({
  children,
  dismissId,
  dismissTitle,
  onClick,
  testId,
}: InputBannerProps) => {
  const updateSystemStatus = useGlobalStore((state) => state.updateSystemStatus);

  const handleDismiss = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      const current = useGlobalStore.getState().status.dismissedBannerIds || [];
      if (current.includes(dismissId)) return;
      updateSystemStatus({ dismissedBannerIds: [...current, dismissId] });
    },
    [dismissId, updateSystemStatus],
  );

  return (
    <div
      data-home-input-banner
      {...stylex.props(styles.banner, onClick && styles.clickable)}
      data-clickable={Boolean(onClick)}
      data-testid={testId}
      onClick={onClick}
    >
      {children}
      <ActionIcon icon={X} size={'small'} title={dismissTitle} onClick={handleDismiss} />
    </div>
  );
};

interface InputBannerSegmentProps {
  children: ReactNode;
  dismissId: string;
}

export const InputBannerSegment = ({ children, dismissId }: InputBannerSegmentProps) => {
  const dismissed = useGlobalStore(systemStatusSelectors.isBannerDismissed(dismissId));
  return dismissed ? null : children;
};

export const InputBannerQueue = ({ children }: { children: ReactNode }) => (
  <div className={moduleStyles.queue}>{children}</div>
);
