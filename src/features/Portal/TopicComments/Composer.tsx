import { ChatInput, ChatInputActionBar, SendButton } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveConversationResourceAccess } from '@/features/Conversation/hooks/useConversationResourceAccess';
import { useTopicCommentMutations } from '@/features/TopicComment/hooks';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import {
  createTopicCommentDraftKey,
  topicCommentSelectors,
  useTopicCommentStore,
} from '@/store/topicComment';

import { styles } from './styles';
import TopicCommentEditor, { type TopicCommentEditorRef } from './TopicCommentEditor';
import { useComposerSubmit } from './useComposerSubmit';

interface ComposerProps {
  messageId?: string;
  onCreated?: () => void;
  parentCommentId?: string;
  rootReplyCount?: number;
  topicId: string;
}

const Composer = memo<ComposerProps>(
  ({ messageId, onCreated, parentCommentId, rootReplyCount, topicId }) => {
    const { t } = useTranslation('chat');

    const workspaceId = useActiveWorkspaceId();
    const { canUseResource } = useActiveConversationResourceAccess();
    const key = workspaceId
      ? createTopicCommentDraftKey({ messageId, parentCommentId, topicId, workspaceId })
      : '';
    const draft = useTopicCommentStore(topicCommentSelectors.draft(key));
    const [setDraft, setDraftContent, clearDraft] = useTopicCommentStore((s) => [
      s.setDraft,
      s.setDraftContent,
      s.clearDraft,
    ]);
    const { create, creating } = useTopicCommentMutations();
    const shouldSendOnEnter = useEnterToSend();
    const editorRef = useRef<TopicCommentEditorRef>(null);
    const content = draft?.content ?? '';
    const onError = useCallback(() => {
      toast.error(t('topicComment.createFailed'));
    }, [t]);
    const { onPressEnter, submit, submitting } = useComposerSubmit({
      clearDraft,
      content,
      create,
      creating,
      draft,
      editorRef,
      key,
      messageId,
      onCreated,
      onError,
      parentCommentId,
      rootReplyCount,
      setDraft,
      shouldSendOnEnter,
      topicId,
    });

    if (!workspaceId || !canUseResource) return null;

    return (
      <Flexbox className={styles.composer}>
        <ChatInput
          resize={false}
          styles={{ body: { padding: 8 } }}
          footer={
            <ChatInputActionBar
              justify={'flex-end'}
              right={
                <SendButton
                  disabled={creating || submitting || !content.trim()}
                  loading={creating || submitting}
                  shape={'round'}
                  title={t('input.send')}
                  type={'text'}
                  onClick={submit}
                />
              }
            />
          }
        >
          <TopicCommentEditor
            disabled={creating || submitting}
            initialContent={content}
            initialEditorData={draft?.editorData}
            ref={editorRef}
            placeholder={
              parentCommentId
                ? t('topicComment.replyPlaceholder')
                : messageId
                  ? t('topicComment.messagePlaceholder')
                  : t('topicComment.placeholder')
            }
            onPressEnter={onPressEnter}
            onChange={({ content: nextContent, editorData }) =>
              setDraftContent(key, nextContent, editorData)
            }
          />
        </ChatInput>
      </Flexbox>
    );
  },
);

Composer.displayName = 'TopicCommentComposer';

export default Composer;
