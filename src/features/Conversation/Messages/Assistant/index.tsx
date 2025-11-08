'use client';

import { LOADING_FLAT } from '@lobechat/const';
import { UIChatMessage } from '@lobechat/types';
import { Tag } from '@lobehub/ui';
import { useResponsive } from 'antd-style';
import { ReactNode, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { HtmlPreviewAction } from '@/components/HtmlPreview';
import Avatar from '@/features/ChatItem/components/Avatar';
import BorderSpacing from '@/features/ChatItem/components/BorderSpacing';
import ErrorContent from '@/features/ChatItem/components/ErrorContent';
import MessageContent from '@/features/ChatItem/components/MessageContent';
import Title from '@/features/ChatItem/components/Title';
import { useStyles } from '@/features/ChatItem/style';
import { useOpenChatSettings } from '@/hooks/useInterceptingRoutes';
import { useAgentStore } from '@/store/agent';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { chatGroupSelectors, useChatGroupStore } from '@/store/chatGroup';
import { useGlobalStore } from '@/store/global';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors, userProfileSelectors } from '@/store/user/selectors';

import ErrorMessageExtra, { useErrorContent } from '../../Error';
import { markdownElements } from '../../MarkdownElements';
import { useDoubleClickEdit } from '../../hooks/useDoubleClickEdit';
import { normalizeThinkTags, processWithArtifact } from '../../utils/markdown';
import { AssistantActionsBar } from './Actions';
import { AssistantMessageExtra } from './Extra';
import { AssistantMessageContent } from './MessageContent';

const rehypePlugins = markdownElements.map((element) => element.rehypePlugin).filter(Boolean);
const remarkPlugins = markdownElements.map((element) => element.remarkPlugin).filter(Boolean);

const isHtmlCode = (content: string, language: string) => {
  return (
    language === 'html' ||
    (language === '' && content.includes('<html>')) ||
    (language === '' && content.includes('<!DOCTYPE html>'))
  );
};
const MOBILE_AVATAR_SIZE = 32;

interface AssistantMessageProps extends UIChatMessage {
  disableEditing?: boolean;
  index: number;
  showTitle?: boolean;
}
const AssistantMessage = memo<AssistantMessageProps>((props) => {
  const {
    error,
    showTitle,
    id,
    role,
    search,
    disableEditing,
    index,
    content,
    createdAt,
    tools,
    extra,
    metadata,
    meta,
    targetId,
  } = props;
  const avatar = meta;
  const { t } = useTranslation('chat');
  const { mobile } = useResponsive();
  const placement = 'left';
  const type = useAgentStore(agentChatConfigSelectors.displayMode);
  const variant = type === 'chat' ? 'bubble' : 'docs';

  const { transitionMode, highlighterTheme, mermaidTheme } = useUserStore(
    userGeneralSettingsSelectors.config,
  );

  const [generating, isInRAGFlow, editing] = useChatStore((s) => [
    chatSelectors.isMessageGenerating(id)(s),
    chatSelectors.isMessageInRAGFlow(id)(s),
    chatSelectors.isMessageEditing(id)(s),
  ]);

  const { styles } = useStyles({
    editing,
    placement,
    primary: false,
    showTitle,
    time: createdAt,
    title: avatar.title,
    variant,
  });
  const errorContent = useErrorContent(error);

  // remove line breaks in artifact tag to make the ast transform easier
  const message = !editing ? normalizeThinkTags(processWithArtifact(content)) : content;

  // when the message is in RAG flow or the AI generating, it should be in loading state
  const loading = isInRAGFlow || generating;

  const animated = transitionMode === 'fadeIn' && generating;

  const isGroupSession = useSessionStore(sessionSelectors.isCurrentSessionGroupSession);
  const currentSession = useSessionStore(sessionSelectors.currentSession);
  const sessionId = isGroupSession && currentSession ? currentSession.id : '';
  const groupConfig = useChatGroupStore(chatGroupSelectors.getGroupConfig(sessionId || ''));

  const reducted =
    isGroupSession && targetId !== null && targetId !== 'user' && !groupConfig?.revealDM;

  // Get target name for DM indicator
  const userName = useUserStore(userProfileSelectors.nickName) || 'User';
  const agents = useSessionStore(sessionSelectors.currentGroupAgents);

  const dmIndicator = useMemo(() => {
    if (!targetId) return undefined;

    let targetName = targetId;
    if (targetId === 'user') {
      targetName = t('dm.you');
    } else {
      const targetAgent = agents?.find((agent) => agent.id === targetId);
      targetName = targetAgent?.title || targetId;
    }

    return <Tag>{t('dm.visibleTo', { target: targetName })}</Tag>;
  }, [targetId, userName, agents, t]);

  // ======================= Performance Optimization ======================= //
  // these useMemo/useCallback are all for the performance optimization
  // maybe we can remove it in React 19
  // ======================================================================== //

  const components = useMemo(
    () =>
      Object.fromEntries(
        markdownElements.map((element) => {
          const Component = element.Component;

          return [element.tag, (props: any) => <Component {...props} id={id} />];
        }),
      ),
    [id],
  );

  const markdownProps = useMemo(
    () => ({
      animated,
      citations: search?.citations,
      componentProps: {
        highlight: {
          actionsRender: ({ content, actionIconSize, language, originalNode }: any) => {
            const showHtmlPreview = isHtmlCode(content, language);

            return (
              <>
                {showHtmlPreview && <HtmlPreviewAction content={content} size={actionIconSize} />}
                {originalNode}
              </>
            );
          },
          theme: highlighterTheme,
        },
        mermaid: { theme: mermaidTheme },
      },
      components,
      enableCustomFootnotes: true,
      rehypePlugins,
      remarkPlugins,
      showFootnotes:
        search?.citations &&
        // if the citations are all empty, we should not show the citations
        search?.citations.length > 0 &&
        // if the citations's url and title are all the same, we should not show the citations
        search?.citations.every((item) => item.title !== item.url),
    }),
    [animated, components, role, search, highlighterTheme, mermaidTheme],
  );

  const [isInbox] = useSessionStore((s) => [sessionSelectors.isInboxSession(s)]);
  const [toggleSystemRole] = useGlobalStore((s) => [s.toggleSystemRole]);
  const openChatSettings = useOpenChatSettings();

  const onAvatarClick = useCallback(() => {
    if (!isInbox) {
      toggleSystemRole(true);
    } else {
      openChatSettings();
    }
  }, [isInbox]);

  const onDoubleClick = useDoubleClickEdit({ disableEditing, error, id, index, role });

  const renderMessage = useCallback(
    (editableContent: ReactNode) => (
      <AssistantMessageContent {...props} editableContent={editableContent} />
    ),
    [props],
  );
  const errorMessage = <ErrorMessageExtra data={props} />;
  return (
    <Flexbox
      className={styles.container}
      direction={placement === 'left' ? 'horizontal' : 'horizontal-reverse'}
      gap={mobile ? 6 : 12}
    >
      <Avatar
        alt={avatar.title || 'avatar'}
        avatar={avatar}
        loading={loading}
        onClick={onAvatarClick}
        placement={placement}
        size={mobile ? MOBILE_AVATAR_SIZE : undefined}
        style={{ marginTop: 6 }}
      />
      <Flexbox align={'flex-start'} className={styles.messageContainer}>
        <Title
          avatar={avatar}
          placement={placement}
          showTitle={showTitle}
          time={createdAt}
          titleAddon={dmIndicator}
        />
        <Flexbox
          align={'flex-start'}
          className={styles.messageContent}
          data-layout={'vertical'} // 添加数据属性以方便样式选择
          direction={'vertical'}
          gap={8}
        >
          <Flexbox style={{ flex: 1, maxWidth: '100%' }}>
            {error && (message === LOADING_FLAT || !message) ? (
              <ErrorContent error={errorContent} message={errorMessage} placement={placement} />
            ) : (
              <MessageContent
                editing={editing}
                id={id}
                markdownProps={markdownProps}
                message={reducted ? `*${t('hideForYou')}*` : message}
                messageExtra={
                  <>
                    {errorContent && (
                      <ErrorContent
                        error={errorContent}
                        message={errorMessage}
                        placement={placement}
                      />
                    )}
                    <AssistantMessageExtra
                      content={content}
                      extra={extra}
                      id={id}
                      metadata={metadata}
                      tools={tools}
                    />
                  </>
                }
                onDoubleClick={onDoubleClick}
                placement={placement}
                renderMessage={renderMessage}
                variant={variant}
              />
            )}
          </Flexbox>
          {!disableEditing && !editing && (
            <Flexbox align={'flex-start'} className={styles.actions} role="menubar">
              <AssistantActionsBar data={props} id={id} index={index} />
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
      {mobile && <BorderSpacing borderSpacing={MOBILE_AVATAR_SIZE} />}
    </Flexbox>
  );
});

export default AssistantMessage;
