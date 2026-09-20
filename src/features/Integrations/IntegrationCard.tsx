'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { IntegrationDefinition } from './registry';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    cursor: pointer;
    padding: 16px;
    border-radius: ${cssVar.borderRadiusLG};
    transition:
      background 0.2s ease,
      border-color 0.2s ease;

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  compact: css`
    padding-block: 14px;
  `,
  dot: css`
    display: inline-block;
    flex: none;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
  `,
  icon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 44px;
    height: 44px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorBgLayout};

    background: ${cssVar.colorText};
  `,
}));

interface IntegrationCardProps {
  /** Shorter card for the Enabled strip: name plus status, no description. */
  compact?: boolean;
  enabled: boolean;
  integration: IntegrationDefinition;
  onOpen: (id: IntegrationDefinition['id']) => void;
}

const IntegrationCard = memo<IntegrationCardProps>(({ compact, enabled, integration, onOpen }) => {
  const { t } = useTranslation('integration');
  const Icon = integration.icon;

  const status = (
    <Flexbox horizontal align="center" gap={6} style={{ flex: 'none' }}>
      {enabled ? <span className={styles.dot} /> : null}
      <Text style={{ fontSize: 13 }} type="secondary">
        {enabled ? t('overview.status.enabled') : t('overview.status.notConnected')}
      </Text>
    </Flexbox>
  );

  return (
    <Block
      className={cx(styles.card, compact && styles.compact)}
      role="button"
      variant={'filled'}
      onClick={() => onOpen(integration.id)}
    >
      <Flexbox horizontal align="center" gap={14}>
        <span className={styles.icon}>
          <Icon size={26} />
        </span>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text strong style={{ fontSize: 15 }}>
            {integration.name}
          </Text>
          {compact ? null : (
            <Text style={{ fontSize: 13 }} type="secondary">
              {t(`${integration.id}.tagline`)}
            </Text>
          )}
        </Flexbox>
        {status}
      </Flexbox>
    </Block>
  );
});

IntegrationCard.displayName = 'IntegrationCard';

export default IntegrationCard;
