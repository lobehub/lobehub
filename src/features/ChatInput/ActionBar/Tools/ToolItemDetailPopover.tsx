import { Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    width: 320px;
    padding: 12px;
  `,
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 6;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  identifier: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

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
      <Flexbox className={styles.container} gap={10}>
        <Flexbox horizontal align={'center'} gap={10}>
          {icon}
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={6}>
              <Text ellipsis className={styles.title}>
                {title}
              </Text>
              {sourceLabel && (
                <Tag size={'small'} style={{ flexShrink: 0 }}>
                  {sourceLabel}
                </Tag>
              )}
            </Flexbox>
            {identifier && <span className={styles.identifier}>{identifier}</span>}
          </Flexbox>
        </Flexbox>
        {description && <div className={styles.description}>{description}</div>}
        {meta}
      </Flexbox>
    );
  },
);

ToolItemDetailPopover.displayName = 'ToolItemDetailPopover';

export default ToolItemDetailPopover;
