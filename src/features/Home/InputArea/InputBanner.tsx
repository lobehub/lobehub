import { ActionIcon } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { X } from 'lucide-react';
import type { MouseEvent, MouseEventHandler, ReactNode } from 'react';
import { useCallback } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  banner: css`
    position: relative;
    z-index: 0;

    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    min-width: 0;
    margin-block: -44px -6px;
    padding-block: 42px 10px;
    padding-inline: 16px 12px;
    border: 1px solid ${cssVar.colorFillSecondary};
    border-radius: 20px;

    background: color-mix(in srgb, ${cssVar.colorFillQuaternary} 50%, ${cssVar.colorBgContainer});

    &[data-clickable='true'] {
      cursor: pointer;
    }
  `,
  queue: css`
    display: contents;

    & > [data-home-input-banner] ~ [data-home-input-banner] {
      display: none;
    }
  `,
}));

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
      className={styles.banner}
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
  <div className={styles.queue}>{children}</div>
);
