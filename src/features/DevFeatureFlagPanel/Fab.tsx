'use client';

import { Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FlagIcon } from 'lucide-react';
import { memo } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';

const styles = createStaticStyles(({ css }) => ({
  badge: css`
    pointer-events: none;

    position: absolute;
    inset-block-start: -4px;
    inset-inline-end: -4px;

    min-width: 16px;
    height: 16px;
    padding-inline: 4px;
    border: 1.5px solid ${cssVar.colorBgContainer};
    border-radius: 8px;

    font-size: 10px;
    font-weight: 600;
    line-height: 13px;
    color: ${cssVar.colorBgContainer};
    text-align: center;

    background: ${cssVar.colorWarning};
  `,
  fab: css`
    cursor: pointer;
    user-select: none;

    position: fixed;
    z-index: 1100;
    inset-block-end: 64px;
    inset-inline-end: 16px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border: 1px solid transparent;
    border-radius: 50%;

    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorText};
    box-shadow: 0 2px 8px rgb(0 0 0 / 12%);

    transition:
      transform 160ms ease,
      background 160ms ease,
      color 160ms ease,
      border-color 160ms ease;

    &:hover {
      transform: scale(1.04);
    }
  `,
  fabActive: css`
    border-color: ${cssVar.colorBorder};
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
}));

interface FabProps {
  active: boolean;
  onToggle: () => void;
}

const Fab = memo<FabProps>(({ active, onToggle }) => {
  const overrideCount = useServerConfigStore((s) => Object.keys(s._featureFlagOverrides).length);

  return (
    <Tooltip placement={'left'} title={'Feature Flag Overrides (dev only)'}>
      <div
        className={`${styles.fab} ${active ? styles.fabActive : ''}`}
        role={'button'}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <FlagIcon size={18} />
        {overrideCount > 0 && <span className={styles.badge}>{overrideCount}</span>}
      </div>
    </Tooltip>
  );
});

Fab.displayName = 'DevFeatureFlagPanel/Fab';

export default Fab;
