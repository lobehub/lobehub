import { ChatInput, SendButton } from '@lobehub/editor/react';
import { Flexbox, toast } from '@lobehub/ui';
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
  /** Focus the input on mount: the user opened this view to write. */
  autoFocus?: boolean;
  messageId?: string;
  onCreated?: () => void;
  parentCommentId?: string;
  rootReplyCount?: number;
  topicId: string;
}

const Composer = memo<ComposerProps>(
  ({ autoFocus, messageId, onCreated, parentCommentId, rootReplyCount, topicId }) => {
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

    const busy = creating || submitting;
    const placeholder = parentCommentId
      ? t('topicComment.replyPlaceholder')
      : messageId
        ? t('topicComment.messagePlaceholder')
        : t('topicComment.placeholder');

    return (
      <Flexbox className={styles.composer}>
        <ChatInput minHeight={0} resize={false} styles={{ body: { padding: 0 } }}>
          <div className={styles.composerRow}>
            <div className={styles.composerEditor}>
              <TopicCommentEditor
                compact
                autoFocus={autoFocus}
                disabled={busy}
                initialContent={content}
                initialEditorData={draft?.editorData}
                placeholder={placeholder}
                ref={editorRef}
                onPressEnter={onPressEnter}
                onChange={({ content: nextContent, editorData }) =>
                  setDraftContent(key, nextContent, editorData)
                }
              />
            </div>
            {/* Enter sends; like the Channel composer, Send appears once there is something to send. */}
            {(busy || Boolean(content.trim())) && (
              <SendButton
                aria-label={t('input.send')}
                disabled={busy}
                loading={busy}
                shape={'round'}
                size={28}
                title={t('input.send')}
                type={'primary'}
                onClick={submit}
              />
            )}
          </div>
        </ChatInput>
      </Flexbox>
    );
  },
);

Composer.displayName = 'TopicCommentComposer';

export default Composer;
