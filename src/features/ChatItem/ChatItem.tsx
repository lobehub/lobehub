'use client';

import { useResponsive } from 'antd-style';
import { memo, useRef, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import Actions from './components/Actions';
import Avatar from './components/Avatar';
import BorderSpacing from './components/BorderSpacing';
import ErrorContent from './components/ErrorContent';
import MessageContent from './components/MessageContent';
import Title from './components/Title';
import { useStyles } from './style';
import type { ChatItemProps } from './type';

const MOBILE_AVATAR_SIZE = 32;

const ChatItem = memo<ChatItemProps>(
  ({
    avatarAddon,
    onAvatarClick,
    avatarProps,
    actions,
    className,
    primary,
    loading,
    message,
    placeholderMessage = '...',
    placement = 'left',
    variant = 'bubble',
    avatar,
    error,
    showTitle,
    time,
    editing,
    messageExtra,
    renderMessage,
    errorMessage,
    onDoubleClick,
    aboveMessage,
    belowMessage,
    markdownProps,
    showAvatar = true,
    titleAddon,
    disabled = false,
    id,
    ...rest
  }) => {
    const { mobile } = useResponsive();
    const { cx, styles } = useStyles({
      disabled,
      editing,
      placement,
      primary,
      showTitle,
      time,
      title: avatar.title,
      variant,
    });

    const contentRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [layoutMode] = useState<'horizontal' | 'vertical'>(
      placement === 'right' ? 'horizontal' : 'vertical',
    );

    return (
      <Flexbox
        className={cx(styles.container, className)}
        direction={placement === 'left' ? 'horizontal' : 'horizontal-reverse'}
        gap={mobile ? 6 : 12}
        {...rest}
      >
        {showAvatar && (
          <Avatar
            {...avatarProps}
            addon={avatarAddon}
            alt={avatarProps?.alt || avatar.title || 'avatar'}
            avatar={avatar}
            loading={loading}
            onClick={onAvatarClick}
            placement={placement}
            size={mobile ? MOBILE_AVATAR_SIZE : undefined}
            style={{
              marginTop: showTitle ? -12 : 6,
              ...avatarProps?.style,
            }}
          />
        )}
        <Flexbox
          align={placement === 'left' ? 'flex-start' : 'flex-end'}
          className={styles.messageContainer}
          ref={containerRef}
        >
          <Title
            avatar={avatar}
            placement={placement}
            showTitle={showTitle}
            time={time}
            titleAddon={titleAddon}
          />
          {aboveMessage}
          <Flexbox
            align={placement === 'left' ? 'flex-start' : 'flex-end'}
            className={styles.messageContent}
            data-layout={layoutMode}
            direction={
              layoutMode === 'horizontal'
                ? placement === 'left'
                  ? 'horizontal'
                  : 'horizontal-reverse'
                : 'vertical'
            }
            gap={8}
          >
            <Flexbox ref={contentRef} width={'100%'}>
              {error && (message === placeholderMessage || !message) ? (
                <ErrorContent error={error} message={errorMessage} placement={placement} />
              ) : (
                id && (
                  <MessageContent
                    disabled={disabled}
                    editing={editing}
                    id={id}
                    markdownProps={markdownProps}
                    message={message}
                    messageExtra={
                      <>
                        {error && (
                          <ErrorContent
                            error={error}
                            message={errorMessage}
                            placement={placement}
                          />
                        )}
                        {messageExtra}
                      </>
                    }
                    onDoubleClick={onDoubleClick}
                    placement={placement}
                    primary={primary}
                    renderMessage={renderMessage}
                    variant={variant}
                  />
                )
              )}
            </Flexbox>
            {actions && (
              <Actions
                actions={actions}
                editing={editing}
                placement={placement}
                variant={variant}
              />
            )}
          </Flexbox>
          {belowMessage}
        </Flexbox>
        {mobile && variant === 'bubble' && showAvatar && (
          <BorderSpacing borderSpacing={MOBILE_AVATAR_SIZE} />
        )}
      </Flexbox>
    );
  },
);

export default ChatItem;

export type { ChatItemProps } from './type';
