'use client';

import { cx, Flexbox, Icon, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { Loader2, MessageSquare } from 'lucide-react';
import { memo } from 'react';

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
      <div className={cx(styles.pin, classNames?.pin)} style={customStyles?.pin}>
        <div className={styles.triangle} />
      </div>
    );

    const actionsNode = actions && (
      <Flexbox
        horizontal
        className={cx(styles.actions, classNames?.actions)}
        gap={4}
        style={{ display: showAction ? undefined : 'none', ...customStyles?.actions }}
        onClick={preventDefaultAndStopPropagation}
      >
        {actions}
      </Flexbox>
    );

    const timeNode = date && (
      <div
        className={cx(styles.date, classNames?.date)}
        style={{ opacity: showAction ? 0 : undefined, ...customStyles?.date }}
      >
        {getChatItemTime(date)}
      </div>
    );

    return (
      <Flexbox
        horizontal
        align={'flex-start'}
        className={cx(styles.root, active && styles.active, className)}
        distribution={'space-between'}
        gap={8}
        padding={12}
        ref={ref}
        style={style}
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
          <Flexbox
            className={cx(styles.content, classNames?.content)}
            gap={4}
            style={customStyles?.content}
          >
            <Text
              ellipsis
              as={'h3'}
              className={cx(styles.title, classNames?.title)}
              style={customStyles?.title}
            >
              {title}
            </Text>
            {description && (
              <Text
                ellipsis
                className={cx(styles.desc, classNames?.desc)}
                style={customStyles?.desc}
              >
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
