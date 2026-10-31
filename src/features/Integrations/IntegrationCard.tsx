'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type KeyboardEvent, memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { IntegrationDefinition, UpcomingIntegration } from './registry';

const styles = stylex.create({
  card: {
    paddingBlock: '14px',
    paddingInline: '16px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
    transition: 'background 0.2s ease,\n      border-color 0.2s ease',
  },
  compact: { paddingBlock: '12px' },
  dot: {
    display: 'inline-block',
    flex: 'none',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorSuccess,
    backgroundImage: 'none',
  },
  icon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  openable: {
    cursor: 'pointer',
    borderColor: { 'default': null, ':hover': cssVar.colorBorder },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimaryBorderHover },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  upcoming: {
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  upcomingCard: { paddingBlock: '10px', paddingInline: '14px' },
});

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
    const open = () => onOpen?.(integration.id as IntegrationDefinition['id']);

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
        // `role="button"` alone leaves the card unreachable: it has to take
        // focus and answer Enter / Space the way a real button does.
        tabIndex={openable ? 0 : undefined}
        variant={'filled'}
        className={
          stylex.props(
            styles.card,
            compact && styles.compact,
            upcoming && styles.upcomingCard,
            openable && styles.openable,
          ).className
        }
        onClick={openable ? open : undefined}
        onKeyDown={
          openable
            ? (event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                open();
              }
            : undefined
        }
      >
        <Flexbox horizontal align="center" gap={14}>
          <span
            className={stylex.props(styles.icon, upcoming && styles.upcoming).className}
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
            {enabled && !upcoming ? <span {...stylex.props(styles.dot)} /> : null}
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
