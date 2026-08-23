'use client';

import type { BlockProps } from '@lobehub/ui';
import { ActionIcon, Block, Popover, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronsUpDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

import Avatar from '@/components/Avatar';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';

const styles = createStaticStyles(({ css, cssVar }) => ({
  trigger: css`
    &[data-popup-open] {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface SidebarHeaderSelectPopoverProps {
  children: ReactNode;
  content: ReactNode;
  width?: number;
}

export const SidebarHeaderSelectPopover = memo<SidebarHeaderSelectPopoverProps>(
  ({ children, content, width = 280 }) => (
    <Popover
      classNames={{ trigger: styles.trigger }}
      content={content}
      nativeButton={false}
      placement={'bottomLeft'}
      trigger={'click'}
      styles={{
        content: {
          maxHeight: 'min(420px, 70vh)',
          overflow: 'hidden',
          padding: 0,
          paddingBlock: 0,
          paddingInline: 0,
          width,
        },
      }}
    >
      {children}
    </Popover>
  ),
);

// Popover clones this trigger to inject onClick/ref; rest must reach Block.
interface SidebarHeaderSelectTriggerProps extends Omit<BlockProps, 'children' | 'title'> {
  avatar?: ReactNode | string;
  background?: string;
  /** Plain-text name behind `title`, seeding the avatar fallback. */
  name?: string;
  title: ReactNode;
}

export const SidebarHeaderSelectTrigger = memo<SidebarHeaderSelectTriggerProps>(
  ({ avatar, background, className, name, style, title, ...rest }) => (
    <Block
      clickable
      horizontal
      align={'center'}
      className={className}
      gap={8}
      padding={2}
      style={{ minWidth: 32, overflow: 'hidden', ...style }}
      variant={'borderless'}
      {...rest}
    >
      <Avatar avatar={avatar} background={background} name={name} shape={'square'} size={28} />
      <Text ellipsis weight={500}>
        {title}
      </Text>
      <ActionIcon
        icon={ChevronsUpDownIcon}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        style={{ width: 24 }}
      />
    </Block>
  ),
);

SidebarHeaderSelectPopover.displayName = 'SidebarHeaderSelectPopover';
SidebarHeaderSelectTrigger.displayName = 'SidebarHeaderSelectTrigger';
