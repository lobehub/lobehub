'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { IntegrationDefinition, UpcomingIntegration } from './registry';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding-block: 14px;
    padding-inline: 16px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};

    transition:
      background 0.2s ease,
      border-color 0.2s ease;
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
  openable: css`
    cursor: pointer;

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  upcoming: css`
    color: ${cssVar.colorTextTertiary};
    background: ${cssVar.colorFillQuaternary};
  `,
  upcomingCard: css`
    padding-block: 10px;
    padding-inline: 14px;
  `,
}));

type CardIntegration = IntegrationDefinition | UpcomingIntegration;

interface IntegrationCardProps {
  /** Shorter card for the Enabled strip: name plus status, no description. */
  compact?: boolean;
  enabled?: boolean;
  integration: CardIntegration;
  /** Absent for an upcoming integration, which has no page to open. */
  onOpen?: (id: IntegrationDefinition['id']) => void;
  /** Roadmap hint: rendered muted, not openable, labelled "Coming soon". */
  upcoming?: boolean;
}

const IntegrationCard = memo<IntegrationCardProps>(
  ({ compact, enabled, integration, onOpen, upcoming }) => {
    const { t } = useTranslation('integration');
    const Icon = integration.icon;
    const openable = !upcoming && !!onOpen;

    const statusLabel = upcoming
      ? t('overview.status.comingSoon')
      : enabled
        ? t('overview.status.enabled')
        : t('overview.status.notConnected');

    const tagline = upcoming
      ? t(`upcoming.${integration.id}.tagline` as any)
      : t(`${integration.id}.tagline` as any);

    return (
      <Block
        role={openable ? 'button' : undefined}
        variant={'filled'}
        className={cx(
          styles.card,
          compact && styles.compact,
          upcoming && styles.upcomingCard,
          openable && styles.openable,
        )}
        onClick={
          openable ? () => onOpen?.(integration.id as IntegrationDefinition['id']) : undefined
        }
      >
        <Flexbox horizontal align="center" gap={14}>
          <span
            className={cx(styles.icon, upcoming && styles.upcoming)}
            style={upcoming ? { height: 32, width: 32 } : undefined}
          >
            <Icon size={upcoming ? 18 : 24} />
          </span>
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Text strong style={{ fontSize: 15 }} type={upcoming ? 'secondary' : undefined}>
              {integration.name}
            </Text>
            {compact ? null : (
              <Text style={{ fontSize: 13 }} type="secondary">
                {tagline}
              </Text>
            )}
          </Flexbox>
          <Flexbox horizontal align="center" gap={6} style={{ flex: 'none' }}>
            {enabled && !upcoming ? <span className={styles.dot} /> : null}
            <Text style={{ fontSize: 13 }} type="secondary">
              {statusLabel}
            </Text>
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

IntegrationCard.displayName = 'IntegrationCard';

export default IntegrationCard;
