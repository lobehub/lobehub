import { ChatInput, ChatInputActionBar, SendButton } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { App } from 'antd';
import { nanoid } from 'nanoid';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useIsWorkspaceViewer } from '@/business/client/hooks/useIsWorkspaceViewer';
import { useTopicCommentMutations } from '@/features/TopicComment/hooks';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import {
  createTopicCommentDraftKey,
  topicCommentSelectors,
  useTopicCommentStore,
} from '@/store/topicComment';

import { styles } from './styles';
import TopicCommentEditor, {
  type TopicCommentEditorRef,
  type TopicCommentEditorValue,
} from './TopicCommentEditor';

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
    const { message } = App.useApp();
    const workspaceId = useActiveWorkspaceId();
    const isViewer = useIsWorkspaceViewer();
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
    const submittingRef = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const content = draft?.content ?? '';

    const submit = useCallback(async () => {
      const editorValue: TopicCommentEditorValue = editorRef.current?.getValue() ?? {
        content,
        editorData: draft?.editorData ?? null,
      };
      const value = editorValue.content.trim();
      if (!key || !value || creating || submittingRef.current) return;

      submittingRef.current = true;
      setSubmitting(true);
      const clientId = draft?.clientId ?? nanoid();
      const submittedDraft = { clientId, ...editorValue };
      setDraft(key, submittedDraft);
      clearDraft(key, clientId);
      editorRef.current?.clean();
      try {
        await create(
          {
            clientId,
            content: value,
            editorData: editorValue.editorData,
            messageId,
            parentCommentId,
            topicId,
          },
          { rootReplyCount },
        );
        onCreated?.();
      } catch {
        setDraft(key, submittedDraft);
        editorRef.current?.setValue(editorValue);
        editorRef.current?.focus();
        message.error(t('topicComment.createFailed'));
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }, [
      clearDraft,
      content,
      create,
      creating,
      draft?.clientId,
      draft?.editorData,
      key,
      message,
      messageId,
      onCreated,
      parentCommentId,
      rootReplyCount,
      setDraft,
      t,
      topicId,
    ]);

    if (!workspaceId || isViewer) return null;

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
            onChange={({ content: nextContent, editorData }) =>
              setDraftContent(key, nextContent, editorData)
            }
            onPressEnter={(event) => {
              if (!shouldSendOnEnter(event)) return;
              void submit();
              return true;
            }}
          />
        </ChatInput>
      </Flexbox>
    );
  },
);

Composer.displayName = 'TopicCommentComposer';

export default Composer;
