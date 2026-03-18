'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx, useTheme } from 'antd-style';
import { Info } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import { getPlatformIcon } from './const';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;

    width: 100%;
    padding-block: 10px;
    padding-inline: 12px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};
    text-align: start;

    background: transparent;

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &.active {
      font-weight: 500;
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  list: css`
    overflow-y: auto;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;

    padding: 12px;
    padding-block-start: 16px;
  `,
  root: css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;

    width: 260px;
    border-inline-end: 1px solid ${cssVar.colorBorder};
  `,
  statusDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
    box-shadow: 0 0 0 1px ${cssVar.colorBgContainer};
  `,
  title: css`
    padding-inline: 4px;
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface PlatformListProps {
  activeId: string;
  connectedPlatforms: Set<string>;
  onSelect: (id: string) => void;
  platforms: SerializedPlatformDefinition[];
}

const PlatformList = memo<PlatformListProps>(
  ({ platforms, activeId, connectedPlatforms, onSelect }) => {
    const { t } = useTranslation('agent');
    const theme = useTheme();

    return (
      <aside className={styles.root}>
        <div className={styles.list}>
          <div className={styles.title}>{t('channel.platforms')}</div>
          {platforms.map((platform) => {
            const PlatformIcon = getPlatformIcon(platform.name);
            const ColorIcon =
              PlatformIcon && 'Color' in PlatformIcon ? (PlatformIcon as any).Color : PlatformIcon;
            return (
              <button
                className={cx(styles.item, activeId === platform.id && 'active')}
                key={platform.id}
                onClick={() => onSelect(platform.id)}
              >
                {ColorIcon && <ColorIcon size={20} />}
                <span style={{ flex: 1 }}>{platform.name}</span>
                {connectedPlatforms.has(platform.id) && <div className={styles.statusDot} />}
              </button>
            );
          })}
        </div>
        <div style={{ borderTop: `1px solid ${theme.colorBorder}`, padding: 12 }}>
          <a
            href="https://lobehub.com/docs/usage/channels/overview"
            rel="noopener noreferrer"
            target="_blank"
            style={{
              alignItems: 'center',
              color: theme.colorTextSecondary,
              display: 'flex',
              fontSize: 12,
              gap: 4,
            }}
          >
            <Icon icon={Info} size={'small'} /> {t('channel.documentation')}
          </a>
        </div>
      </aside>
    );
  },
);

export default PlatformList;
