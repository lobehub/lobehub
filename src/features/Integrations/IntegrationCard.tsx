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
    transition: border-color 0.2s ease;

    &:hover {
      border-color: ${cssVar.colorPrimaryBorderHover};
    }
  `,
  compact: css`
    padding-block: 12px;
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

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface IntegrationCardProps {
  /** Shorter card for the Enabled strip; the full card carries a description. */
  compact?: boolean;
  enabled: boolean;
  integration: IntegrationDefinition;
  onOpen: (id: IntegrationDefinition['id']) => void;
}

const IntegrationCard = memo<IntegrationCardProps>(({ compact, enabled, integration, onOpen }) => {
  const { t } = useTranslation('integration');
  const Icon = integration.icon;

  return (
    <Block
      className={cx(styles.card, compact && styles.compact)}
      role="button"
      variant={'outlined'}
      onClick={() => onOpen(integration.id)}
    >
      <Flexbox horizontal align="center" gap={12}>
        <span className={styles.icon}>
          <Icon size={24} />
        </span>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text strong style={{ fontSize: 15 }}>
            {integration.name}
          </Text>
          {compact ? (
            <Flexbox horizontal align="center" gap={6}>
              {enabled ? <span className={styles.dot} /> : null}
              <Text style={{ fontSize: 13 }} type="secondary">
                {enabled ? t('overview.status.enabled') : t('overview.status.notConnected')}
              </Text>
            </Flexbox>
          ) : (
            <Text style={{ fontSize: 13 }} type="secondary">
              {t(`${integration.id}.tagline`)}
            </Text>
          )}
        </Flexbox>
        {!compact && enabled ? (
          <Flexbox horizontal align="center" gap={6}>
            <span className={styles.dot} />
            <Text style={{ fontSize: 13 }} type="secondary">
              {t('overview.status.enabled')}
            </Text>
          </Flexbox>
        ) : null}
      </Flexbox>
    </Block>
  );
});

IntegrationCard.displayName = 'IntegrationCard';

export default IntegrationCard;
