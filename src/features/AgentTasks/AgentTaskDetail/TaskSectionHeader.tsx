'use client';

import { Block, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import type { LucideIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import AccordionArrowIcon from '../shared/AccordionArrowIcon';

interface TaskSectionHeaderProps {
  /** A number or short string renders as muted text; any other node renders as is. */
  count?: ReactNode;
  /** Section-level actions, outside the toggle. */
  extra?: ReactNode;
  icon: LucideIcon;
  isOpen?: boolean;
  /** Without it the header is a static heading with no arrow. */
  onToggle?: () => void;
  title: ReactNode;
}

/**
 * The one heading every task detail section uses: icon, title, count, arrow,
 * then the section's own actions on the right. The icon sits in the same
 * column whether or not the section folds, so the sections read as one list.
 */
const TaskSectionHeader = memo<TaskSectionHeaderProps>(
  ({ count, extra, icon, isOpen = true, onToggle, title }) => {
    const hasCount = count !== undefined && count !== null && count !== false && count !== '';
    const content = (
      <>
        <Icon color={cssVar.colorTextDescription} icon={icon} size={16} />
        <Text weight={500}>{title}</Text>
        {hasCount &&
          (typeof count === 'string' || typeof count === 'number' ? (
            <Text color={cssVar.colorTextDescription} fontSize={12}>
              {count}
            </Text>
          ) : (
            count
          ))}
        {onToggle && (
          <AccordionArrowIcon isOpen={isOpen} style={{ color: cssVar.colorTextDescription }} />
        )}
      </>
    );

    const heading = onToggle ? (
      <Block
        clickable
        horizontal
        align={'center'}
        aria-expanded={isOpen}
        gap={8}
        paddingBlock={4}
        paddingInline={8}
        role={'button'}
        style={{ cursor: 'pointer', marginInlineStart: -8, minWidth: 0, width: 'fit-content' }}
        variant={'borderless'}
        onClick={onToggle}
      >
        {content}
      </Block>
    ) : (
      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        paddingBlock={4}
        paddingInline={8}
        style={{ marginInlineStart: -8, minWidth: 0 }}
      >
        {content}
      </Flexbox>
    );

    if (!extra) return heading;

    return (
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        {heading}
        {/* Outside the toggle: an action should not also fold the section. */}
        <Flexbox
          horizontal
          align={'center'}
          gap={4}
          style={{ flex: 'none' }}
          onClick={(event) => event.stopPropagation()}
        >
          {extra}
        </Flexbox>
      </Flexbox>
    );
  },
);

TaskSectionHeader.displayName = 'TaskSectionHeader';

export default TaskSectionHeader;
