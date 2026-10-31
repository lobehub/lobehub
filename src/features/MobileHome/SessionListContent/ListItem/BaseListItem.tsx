'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { Loader2, MessageSquare } from 'lucide-react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

import { styles } from './style';
import type { ListItemProps } from './type';

const getChatItemTime = (updateAt: number) => {
  const time = dayjs(updateAt);
  return time.isSame(dayjs(), 'day') ? time.format('HH:mm') : time.format('MM-DD');
};

const preventDefaultAndStopPropagation = (e: {
  preventDefault: () => void;
  stopPropagation: () => void;
}) => {
  e.preventDefault();
  e.stopPropagation();
};

const BaseListItem = memo<ListItemProps>(
  ({
    ref,
    active,
    avatar,
    loading,
    description,
    date,
    title,
    onHoverChange,
    actions,
    className,
    style,
    showAction,
    children,
    classNames,
    addon,
    pin,
    styles: customStyles,
    ...rest
  }) => {
    const loadingNode = <Icon spin icon={Loader2} />;

    const pinNode = pin && (
      <div {...sx([styles.pin], classNames?.pin, customStyles?.pin)}>
        <div {...stylex.props(styles.triangle)} />
      </div>
    );

    const actionsNode = actions && (
      <Flexbox
        horizontal
        gap={4}
        {...sx([styles.actions], classNames?.actions, {
          display: showAction ? undefined : 'none',
          ...customStyles?.actions,
        })}
        onClick={preventDefaultAndStopPropagation}
      >
        {actions}
      </Flexbox>
    );

    const timeNode = date && (
      <div
        {...sx([styles.date], classNames?.date, {
          opacity: showAction ? 0 : undefined,
          ...customStyles?.date,
        })}
      >
        {getChatItemTime(date)}
      </div>
    );

    return (
      <Flexbox
        horizontal
        align={'flex-start'}
        distribution={'space-between'}
        gap={8}
        padding={12}
        ref={ref}
        {...sx([styles.root, active && styles.active], className, style)}
        onMouseEnter={() => {
          onHoverChange?.(true);
        }}
        onMouseLeave={() => {
          onHoverChange?.(false);
        }}
        {...rest}
      >
        {pinNode}
        <Flexbox
          horizontal
          align={'flex-start'}
          className={classNames?.container}
          flex={1}
          gap={8}
          style={{ overflow: 'hidden', ...customStyles?.container }}
        >
          {avatar ?? <Icon icon={MessageSquare} style={{ marginTop: 4 }} />}
          <Flexbox gap={4} {...sx([styles.content], classNames?.content, customStyles?.content)}>
            <Text
              ellipsis
              as={'h3'}
              {...sx([styles.title], classNames?.title, customStyles?.title)}
            >
              {title}
            </Text>
            {description && (
              <Text ellipsis {...sx([styles.desc], classNames?.desc, customStyles?.desc)}>
                {description}
              </Text>
            )}
            {addon}
          </Flexbox>
        </Flexbox>
        {loading ? (
          loadingNode
        ) : (
          <>
            {actionsNode}
            {timeNode}
          </>
        )}
        {children}
      </Flexbox>
    );
  },
);

BaseListItem.displayName = 'BaseListItem';

export default BaseListItem;
