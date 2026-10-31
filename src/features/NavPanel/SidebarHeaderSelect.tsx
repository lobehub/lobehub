'use client';

import type { BlockProps } from '@lobehub/ui';
import { ActionIcon, Block, Popover, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronsUpDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

import Avatar from '@/components/Avatar';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';

const styles = stylex.create({
  trigger: {
    backgroundColor: { 'default': null, ':is([data-popup-open])': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':is([data-popup-open])': 'none' },
  },
});

interface SidebarHeaderSelectPopoverProps {
  children: ReactNode;
  content: ReactNode;
  width?: number;
}

export const SidebarHeaderSelectPopover = memo<SidebarHeaderSelectPopoverProps>(
  ({ children, content, width = 280 }) => (
    <Popover
      classNames={{ trigger: stylex.props(styles.trigger).className }}
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
  /** Rendered as is in place of the avatar tile, e.g. an agent avatar. */
  avatarNode?: ReactNode;
  background?: string;
  /** Plain-text name behind `title`, seeding the avatar fallback. */
  name?: string;
  title: ReactNode;
}

export const SidebarHeaderSelectTrigger = memo<SidebarHeaderSelectTriggerProps>(
  ({ avatar, avatarNode, background, className, name, style, title, ...rest }) => (
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
      {avatarNode ?? (
        <Avatar avatar={avatar} background={background} name={name} shape={'square'} size={28} />
      )}
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
