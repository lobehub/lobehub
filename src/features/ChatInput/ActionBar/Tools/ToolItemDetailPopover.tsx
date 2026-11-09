import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

const styles = stylex.create({
  container: { width: '320px', padding: '12px' },
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '6',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
  },
  identifier: {
    overflow: 'hidden',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  title: { fontSize: '14px', fontWeight: 600, color: cssVar.colorText },
});

interface ToolItemDetailPopoverProps {
  description?: ReactNode;
  icon?: ReactNode;
  identifier?: string;
  meta?: ReactNode;
  sourceLabel?: string;
  title: ReactNode;
}

/**
 * Hover popover content for items rendered in the skill panel.
 * Mirrors the structure of ModelDetailPanel but kept lightweight: a header
 * row (icon + title + source tag), a description block, and an optional
 * identifier line for technical reference.
 */
const ToolItemDetailPopover = memo<ToolItemDetailPopoverProps>(
  ({ icon, title, description, sourceLabel, identifier, meta }) => {
    return (
      <Flexbox className={stylex.props(styles.container).className} gap={10}>
        <Flexbox horizontal align={'center'} gap={10}>
          {icon}
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={6}>
              <Text ellipsis className={stylex.props(styles.title).className}>
                {title}
              </Text>
              {sourceLabel && (
                <Tag size={'small'} style={{ flexShrink: 0 }}>
                  {sourceLabel}
                </Tag>
              )}
            </Flexbox>
            {identifier && <span {...stylex.props(styles.identifier)}>{identifier}</span>}
          </Flexbox>
        </Flexbox>
        {description && <div {...stylex.props(styles.description)}>{description}</div>}
        {meta}
      </Flexbox>
    );
  },
);

ToolItemDetailPopover.displayName = 'ToolItemDetailPopover';

export default ToolItemDetailPopover;
