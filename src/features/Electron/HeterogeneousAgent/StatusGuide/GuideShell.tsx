import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { ReactNode } from 'react';

import type { HeterogeneousAgentStatusGuideVariant } from './types';

interface GuideShellProps {
  actions?: ReactNode;
  children?: ReactNode;
  /**
   * Tighter spacing + smaller avatar/title. Used by transient states (e.g. the
   * overloaded auto-retry progress card) that should read as a lightweight
   * status, not a full error panel.
   */
  compact?: boolean;
  headerDescription?: ReactNode;
  icon: ReactNode;
  title: string;
  variant: HeterogeneousAgentStatusGuideVariant;
}

const GuideShell = ({
  actions,
  children,
  compact = false,
  headerDescription,
  icon,
  title,
  variant,
}: GuideShellProps) => {
  const showHeader = variant !== 'embedded';
  // Compact cards keep the actions on the same row as the title/description
  // (right-aligned) so the whole status reads as a single tight line.
  const actionsInHeader = compact && showHeader;
  const content = (
    <Flexbox gap={compact ? 8 : 12}>
      {showHeader ? (
        <Flexbox horizontal align="center" gap={compact ? 10 : 12} justify="space-between">
          <Flexbox horizontal align="center" gap={compact ? 10 : 12} style={{ minWidth: 0 }}>
            <Avatar
              avatar={icon}
              background={cssVar.colorFillQuaternary}
              gap={compact ? 8 : 12}
              shape={'square'}
              size={compact ? 32 : 48}
            />
            <Flexbox gap={2} style={{ minWidth: 0 }}>
              <Text ellipsis={compact} style={{ fontSize: compact ? 14 : 16, fontWeight: 600 }}>
                {title}
              </Text>
              {headerDescription}
            </Flexbox>
          </Flexbox>
          {actionsInHeader && <Flexbox style={{ flexShrink: 0 }}>{actions}</Flexbox>}
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
      gap={compact ? 12 : 16}
      padding={compact ? 12 : 16}
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
