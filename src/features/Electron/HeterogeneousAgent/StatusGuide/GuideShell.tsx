import { type InterfaceDensity } from '@lobechat/types';
import { ActionIcon, Avatar, Block, cssVar, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { DENSITY_TOKENS, useDensity } from '@/styles/density';

import type { HeterogeneousAgentStatusGuideVariant } from './types';

const AVATAR_SIZE = {
  compact: 32,
  loose: 48,
} as const satisfies Record<InterfaceDensity, number>;

interface GuideShellProps {
  actions?: ReactNode;
  children?: ReactNode;
  /**
   * Tighter spacing + smaller avatar/title. Used by transient states (e.g. the
   * overloaded auto-retry progress card) that should read as a lightweight
   * status, not a full error panel.
   */
  compact?: boolean;
  dismissLabel?: string;
  headerDescription?: ReactNode;
  icon: ReactNode;
  onDismiss?: () => void;
  title: string;
  variant: HeterogeneousAgentStatusGuideVariant;
}

const GuideShell = ({
  actions,
  children,
  compact = false,
  dismissLabel,
  headerDescription,
  icon,
  onDismiss,
  title,
  variant,
}: GuideShellProps) => {
  const { t } = useTranslation('common');
  const { density: interfaceDensity } = useDensity();
  const density: InterfaceDensity = compact ? 'compact' : interfaceDensity;
  const tokens = DENSITY_TOKENS[density];
  const showHeader = variant !== 'embedded';
  // Compact cards keep actions alongside the status when space permits,
  // wrapping them below it in narrow conversation panes.
  const actionsInHeader = compact && showHeader;
  const content = (
    <Flexbox gap={tokens.contentGap}>
      {showHeader ? (
        <Flexbox
          horizontal
          align="center"
          gap={tokens.contentGap}
          justify="space-between"
          style={compact ? { flexWrap: 'wrap' } : undefined}
        >
          <Flexbox
            horizontal
            align="center"
            gap={tokens.contentGap}
            style={{ minWidth: 0, ...(compact && { flex: '1 1 260px' }) }}
          >
            <Avatar
              avatar={icon}
              background={cssVar.colorFillQuaternary}
              shape={'square'}
              size={AVATAR_SIZE[density]}
              style={{ color: cssVar.colorText }}
            />
            <Flexbox gap={2} style={{ minWidth: 0 }}>
              <Text style={{ fontSize: tokens.pageTitleFontSize, fontWeight: 600 }}>{title}</Text>
              {headerDescription}
            </Flexbox>
          </Flexbox>
          {(actionsInHeader || onDismiss) && (
            <Flexbox
              horizontal
              align="center"
              gap={8}
              style={{ flexShrink: 0, marginInlineStart: 'auto', maxWidth: '100%' }}
            >
              {actionsInHeader && actions}
              {onDismiss && (
                <Tooltip title={dismissLabel ?? t('close')}>
                  <ActionIcon
                    aria-label={dismissLabel ?? t('close')}
                    icon={X}
                    size="small"
                    onClick={onDismiss}
                  />
                </Tooltip>
              )}
            </Flexbox>
          )}
        </Flexbox>
      ) : (
        headerDescription
      )}

      {children}
      {!actionsInHeader && actions}
    </Flexbox>
  );

  if (variant !== 'inline') return content;

  return (
    <Block
      gap={tokens.sectionGap}
      padding={tokens.cardPadding}
      variant={'outlined'}
      style={{
        background: cssVar.colorBgElevated,
        overflow: 'hidden',
        width: '100%',
      }}
    >
      {content}
    </Block>
  );
};

export default GuideShell;
