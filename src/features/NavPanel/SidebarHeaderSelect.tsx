'use client';

import { ActionIcon, Avatar, Block, Popover, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronsUpDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

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
  ({ children, content, width = 240 }) => (
    <Popover
      classNames={{ trigger: styles.trigger }}
      content={content}
      nativeButton={false}
      placement={'bottomLeft'}
      styles={{ content: { padding: 0, width } }}
      trigger={'click'}
    >
      {children}
    </Popover>
  ),
);

interface SidebarHeaderSelectTriggerProps {
  avatar?: ReactNode | string;
  background?: string;
  title: ReactNode;
}

export const SidebarHeaderSelectTrigger = memo<SidebarHeaderSelectTriggerProps>(
  ({ avatar, background, title }) => (
    <Block
      clickable
      horizontal
      align={'center'}
      gap={8}
      padding={2}
      style={{ minWidth: 32, overflow: 'hidden' }}
      variant={'borderless'}
    >
      <Avatar avatar={avatar} background={background} shape={'square'} size={28} />
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
