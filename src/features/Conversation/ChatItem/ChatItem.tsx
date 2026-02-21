'use client';

import { Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo } from 'react';

import Actions from './components/Actions';
import Avatar from './components/Avatar';
import ErrorContent from './components/ErrorContent';
import MessageContent from './components/MessageContent';
import Title from './components/Title';
import { styles } from './style';
import { type ChatItemProps } from './type';

const ChatItem = memo<ChatItemProps>(
  ({
    onAvatarClick,
    avatarProps,
    customAvatarRender,
    actions,
    className,
    loading,
    message,
    placeholderMessage = '...',
    placement = 'left',
    avatar,
    error,
    showTitle,
    time,
    editing,
    messageExtra,
    children,
    customErrorRender,
    onDoubleClick,
    aboveMessage,
    belowMessage,
    showAvatar = true,
    titleAddon,
    disabled = false,
    id,
    style,
    newScreenMinHeight,
    ...rest
  }) => {
    const isUser = placement === 'right';
    const isEmptyMessage =
      !message || String(message).trim() === '' || message === placeholderMessage;
    const errorContent = error && (
      <ErrorContent customErrorRender={customErrorRender} error={error} id={id} />
    );

    const avatarContent = (
      <Avatar
        alt={avatarProps?.alt || avatar.title || 'avatar'}
        loading={loading}
        shape={'square'}
        onClick={onAvatarClick}
        {...avatarProps}
        avatar={avatar}
      />
    );

    return (
      <Flexbox
        align={isUser ? 'flex-end' : 'flex-start'}
        className={cx('message-wrapper', styles.container, className)}
        data-message-id={id}
        gap={8}
        paddingBlock={8}
        style={{
          minHeight: newScreenMinHeight,
          paddingInlineStart: isUser ? 36 : 0,
          ...style,
        }}
        {...rest}
      >
        <Flexbox
          align={'center'}
          className={'message-header'}
          direction={isUser ? 'horizontal-reverse' : 'horizontal'}
          gap={8}
        >
          {showAvatar &&
            (customAvatarRender ? customAvatarRender(avatar, avatarContent) : avatarContent)}
          <Title avatar={avatar} showTitle={showTitle} time={time} titleAddon={titleAddon} />
        </Flexbox>
        <Flexbox
          className={'message-body'}
          gap={8}
          style={{
            maxWidth: '100%',
            overflow: 'hidden',
            position: 'relative',
            width: isUser ? undefined : '100%',
          }}
        >
          {aboveMessage}
          {error && isEmptyMessage ? (
            errorContent
          ) : (
            <MessageContent
              disabled={disabled}
              editing={editing}
              id={id!}
              message={message}
              variant={isUser ? 'bubble' : undefined}
              messageExtra={
                <>
                  {errorContent}
                  {messageExtra}
                </>
              }
              onDoubleClick={onDoubleClick}
            >
              {children}
            </MessageContent>
          )}
          {belowMessage}
        </Flexbox>
        {actions && <Actions actions={actions} placement={placement} />}
      </Flexbox>
    );
  },
);

export default ChatItem;
