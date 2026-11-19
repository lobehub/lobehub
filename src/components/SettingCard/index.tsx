'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

import { useInterfaceDensity } from '@/styles/density';

const styles = stylex.create({
  footer: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderBlockStartColor: cssVar.colorFillTertiary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    paddingBlock: 12,
    paddingInline: 20,
  },
  // Compact density: the footer follows the card body's 14px inset.
  footerCompact: {
    paddingBlock: 8,
    paddingInline: 14,
  },
  hint: {
    color: cssVar.colorTextSecondary,
    fontSize: 13,
  },
});

export interface SettingCardProps {
  /** Footer action, usually the card's own Save button. */
  action?: ReactNode;
  children?: ReactNode;
  description?: ReactNode;
  /** Content beside the title, e.g. an avatar that is edited in place. */
  extra?: ReactNode;
  /** Footer note: a limit, or the field's validation message. */
  hint?: ReactNode;
  title: ReactNode;
}

/**
 * One setting per card, saved on its own: title and description, the field,
 * then a footer with a hint and the card's action.
 */
const SettingCard = memo<SettingCardProps>(
  ({ title, description, children, extra, hint, action }) => {
    const compact = useInterfaceDensity() === 'compact';

    return (
      <Block variant="outlined">
        <Flexbox gap={compact ? 10 : 12} padding={compact ? 14 : 20}>
          <Flexbox horizontal align="center" gap={16} justify="space-between">
            <Flexbox gap={compact ? 2 : 4}>
              <Text strong as="h3" style={{ fontSize: compact ? 14 : 16, margin: 0 }}>
                {title}
              </Text>
              {description && (
                <Text style={{ fontSize: compact ? 12 : 13 }} type="secondary">
                  {description}
                </Text>
              )}
            </Flexbox>
            {extra}
          </Flexbox>
          {children}
        </Flexbox>
        {(hint || action) && (
          <Flexbox
            horizontal
            align="center"
            gap={12}
            justify="space-between"
            {...stylex.props(styles.footer, compact && styles.footerCompact)}
          >
            <span {...stylex.props(styles.hint)}>{hint ?? ''}</span>
            {action}
          </Flexbox>
        )}
      </Block>
    );
  },
);

SettingCard.displayName = 'SettingCard';

export default SettingCard;
