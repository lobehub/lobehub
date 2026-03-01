'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx, useTheme } from 'antd-style';
import { Info } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { IntegrationProvider } from './const';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;

    width: 260px;
    border-inline-end: 1px solid ${cssVar.colorBorder};
  `,
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
  providers: IntegrationProvider[];
}

const PlatformList = memo<PlatformListProps>(
  ({ providers, activeId, connectedPlatforms, onSelect }) => {
    const { t } = useTranslation('agent');
    const theme = useTheme();

    return (
      <aside className={styles.root}>
        <div className={styles.list}>
          <div className={styles.title}>{t('integration.platforms')}</div>
          {providers.map((provider) => {
            const ProviderIcon = provider.icon;
            return (
              <button
                className={cx(styles.item, activeId === provider.id && 'active')}
                key={provider.id}
                onClick={() => onSelect(provider.id)}
              >
                <ProviderIcon
                  color={activeId === provider.id ? provider.color : theme.colorTextSecondary}
                  size={20}
                />
                <span style={{ flex: 1 }}>{provider.name}</span>
                {connectedPlatforms.has(provider.id) && <div className={styles.statusDot} />}
              </button>
            );
          })}
        </div>
        <div style={{ borderTop: `1px solid ${theme.colorBorder}`, padding: 12 }}>
          <a
            href="#"
            style={{
              alignItems: 'center',
              color: theme.colorTextSecondary,
              display: 'flex',
              fontSize: 12,
              gap: 4,
            }}
          >
            <Icon icon={Info} size={'small'} /> {t('integration.documentation')}
          </a>
        </div>
      </aside>
    );
  },
);

export default PlatformList;
