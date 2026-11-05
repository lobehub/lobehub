'use client';

import { agentDisplayName } from '@lobechat/types';
import { cx, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { sx } from '@/styles/sx';

import FollowUpChips from '../FollowUp/FollowUpChips';
import { selectionStyles } from '../MessageForward/selectionStyles';
import { contextSelectors, useConversationStore } from '../store';
import Actions from './components/Actions';
import Avatar from './components/Avatar';
import ErrorContent from './components/ErrorContent';
import MessageContent from './components/MessageContent';
import Title from './components/Title';
import { chatItemMarker } from './markers.stylex';
import type { ChatItemProps } from './type';

const LOCATE_HIGHLIGHT = ':is([data-message-locate-highlight])';
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

const backgroundReset = {
  backgroundAttachment: 'initial',
  backgroundClip: 'initial',
  backgroundImage: 'initial',
  backgroundOrigin: 'initial',
  backgroundPositionX: 'initial',
  backgroundPositionY: 'initial',
  backgroundRepeat: 'initial',
  backgroundSize: 'initial',
} as const;

const locateHighlight = stylex.keyframes({
  '0%, 100%': { ...backgroundReset, backgroundColor: 'transparent' },
  '15%, 55%': { ...backgroundReset, backgroundColor: cssVar.colorPrimaryBg },
});

const styles = stylex.create({
  container: {
    position: 'relative',
    maxWidth: '100%',
    borderRadius: { default: null, [LOCATE_HIGHLIGHT]: cssVar.borderRadiusLG },
    backgroundColor: {
      default: null,
      [REDUCED_MOTION]: { default: null, [LOCATE_HIGHLIGHT]: cssVar.colorPrimaryBg },
    },
    backgroundImage: {
      default: null,
      [REDUCED_MOTION]: { default: null, [LOCATE_HIGHLIGHT]: 'none' },
    },
    animationName: {
      default: null,
      [LOCATE_HIGHLIGHT]: locateHighlight,
      [REDUCED_MOTION]: { default: null, [LOCATE_HIGHLIGHT]: 'none' },
    },
    animationDuration: {
      default: null,
      [LOCATE_HIGHLIGHT]: '1400ms',
      [REDUCED_MOTION]: { default: null, [LOCATE_HIGHLIGHT]: '0s' },
    },
    animationTimingFunction: {
      default: null,
      [LOCATE_HIGHLIGHT]: cssVar.motionEaseOut,
      [REDUCED_MOTION]: { default: null, [LOCATE_HIGHLIGHT]: 'ease' },
    },
  },
});

const ChatItem = memo<ChatItemProps>(
  ({
    onAvatarClick,
    avatarProps,
    customAvatarRender,
    afterActions,
    actionAddon,
    agentId,
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
    headerAddon,
    showAvatar = true,
    showHeader = true,
    titleAddon,
    disabled = false,
    id,
    style,
    ...rest
  }) => {
    const isUser = placement === 'right';
    const conversationKey = useConversationStore(contextSelectors.conversationKey);
    const isEmptyMessage =
      !message || String(message).trim() === '' || message === placeholderMessage;
    const errorContent = error && (
      <ErrorContent customErrorRender={customErrorRender} error={error} id={id} />
    );

    const avatarContent = (
      <Avatar
        agentId={agentId}
        alt={avatarProps?.alt || agentDisplayName(avatar, 'avatar')}
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
        data-message-id={id}
        gap={8}
        paddingBlock={8}
        {...rest}
        {...sx([styles.container, chatItemMarker], cx('message-wrapper', className), {
          paddingInlineStart: isUser ? 36 : 0,
          ...style,
        })}
      >
        {showHeader && (
          <Flexbox
            align={'center'}
            className={cx('message-header', stylex.props(selectionStyles.hidden).className)}
            direction={isUser ? 'horizontal-reverse' : 'horizontal'}
            gap={8}
            // The row wraps nothing, so without a cap it is sized by its content and
            // simply overflows its lane — on a narrow viewport that is a header
            // wider than the conversation pane (the source-topic link, a long agent
            // name). Capped, the shrinkable addons yield to the space actually
            // available and truncate instead.
            style={{ maxInlineSize: '100%', minInlineSize: 0 }}
          >
            {showAvatar &&
              (customAvatarRender ? customAvatarRender(avatar, avatarContent) : avatarContent)}
            {headerAddon}
            <Title avatar={avatar} showTitle={showTitle} time={time} titleAddon={titleAddon} />
          </Flexbox>
        )}
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
        {id && conversationKey && (
          <FollowUpChips conversationKey={conversationKey} messageId={id} />
        )}
        {(actionAddon || actions) && (
          <Actions actionAddon={actionAddon} actions={actions} placement={placement} />
        )}
        {afterActions && (
          <Flexbox
            style={{
              width: isUser ? undefined : '100%',
            }}
          >
            {afterActions}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default ChatItem;
