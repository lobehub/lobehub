'use client';

import { type SlashOptions } from '@lobehub/editor';
import { Alert, Avatar, Flexbox } from '@lobehub/ui';
import { isEqual } from 'es-toolkit/compat';
import { Suspense, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import { type ActionKeys, ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import GroupAvatar from '@/features/GroupAvatar';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useChatStore } from '@/store/chat';
import { aiChatSelectors } from '@/store/chat/selectors';

import MessageFromUrl from './MessageFromUrl';
import { useSendMenuItems } from './useSendMenuItems';

const leftActions: ActionKeys[] = [
  'typo',
  'fileUpload',
  '---',
  ['tools', 'params', 'clear'],
  'mainToken',
];

const dmLeftActions: ActionKeys[] = ['typo', 'fileUpload', '---', ['stt']];

const rightActions: ActionKeys[] = [];

/**
 * Message Editor for Group Chat along with DM Portal
 */
const Desktop = memo((props: { targetMemberId?: string }) => {
  const { t } = useTranslation('chat');
  // const { send, generating, disabled, stop } = useSendGroupMessage();

  const isDMPortal = !!props.targetMemberId;
  const currentGroupMembers = useAgentGroupStore(agentGroupSelectors.currentGroupAgents, isEqual);

  const [mainInputSendErrorMsg, clearSendMessageError] = useChatStore((s) => [
    aiChatSelectors.isCurrentSendMessageError(s),
    s.clearSendMessageError,
  ]);

  const mentionItems: SlashOptions['items'] = useMemo(() => {
    if (!currentGroupMembers) return [];
    return [
      {
        icon: (
          <GroupAvatar
            avatars={
              currentGroupMembers?.map((member) => ({
                avatar: member.avatar || DEFAULT_AVATAR,
                background: member.backgroundColor || undefined,
              })) || []
            }
            size={24}
          />
        ),
        key: 'ALL_MEMBERS',
        label: t('memberSelection.allMembers'),
        metadata: { id: 'ALL_MEMBERS' },
      },
      ...currentGroupMembers.map((member) => ({
        icon: (
          <Avatar
            avatar={member.avatar}
            background={member.backgroundColor ?? undefined}
            size={24}
          />
        ),
        key: member.id,
        label: member.title,
        metadata: { id: member.id },
      })),
    ];
  }, [currentGroupMembers]);

  const sendMenuItems = useSendMenuItems();

  return (
    <ChatInputProvider
      chatInputEditorRef={(instance) => {
        if (!instance) return;
        useChatStore.setState({ mainInputEditor: instance });
      }}
      leftActions={isDMPortal ? dmLeftActions : leftActions}
      mentionItems={mentionItems}
      onMarkdownContentChange={(content) => {
        useChatStore.setState({ inputMessage: content });
      }}
      rightActions={isDMPortal ? [] : rightActions}
      // sendButtonProps={{ disabled, generating, onStop: stop }}
      sendMenu={{
        items: sendMenuItems,
      }}
    >
      <WideScreenContainer>
        {mainInputSendErrorMsg && (
          <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
            <Alert
              closable
              onClose={clearSendMessageError}
              title={t('input.errorMsg', { errorMsg: mainInputSendErrorMsg })}
              type={'warning'}
            />
          </Flexbox>
        )}
        <DesktopChatInput />
      </WideScreenContainer>
      <Suspense>
        <MessageFromUrl />
      </Suspense>
    </ChatInputProvider>
  );
});

export default Desktop;
