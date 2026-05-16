import {
  ChatInput,
  ChatInputActionBar,
  Editor,
  SendButton,
  useEditor,
} from '@lobehub/editor/react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';
import { useEnterToSend } from '@/hooks/useEnterToSend';

const FeedbackInput = memo(() => {
  const { t } = useTranslation('chat');
  const editor = useEditor();
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const [submitting, setSubmitting] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const shouldSendOnEnter = useEnterToSend();

  const handleSubmit = useCallback(async () => {
    const trimmed = String(editor?.getDocument?.('markdown') ?? '').trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      // sendMessage is bound to this drawer's ConversationProvider context
      // (agentId + topicId + isolatedTopic), so the message continues this
      // topic's conversation rather than spawning a new run.
      await sendMessage({ message: trimmed });
      editor?.cleanDocument?.();
      setHasContent(false);
    } finally {
      setSubmitting(false);
    }
  }, [editor, sendMessage, submitting]);

  return (
    <ChatInput
      maxHeight={200}
      minHeight={40}
      footer={
        <ChatInputActionBar
          left={null}
          style={{ paddingRight: 8 }}
          right={
            <SendButton
              disabled={!hasContent && !submitting}
              loading={submitting}
              shape={'round'}
              title={t('taskDetail.replyInThread')}
              type={'primary'}
              onClick={handleSubmit}
            />
          }
        />
      }
    >
      <Editor
        content={''}
        editor={editor}
        enablePasteMarkdown={false}
        markdownOption={false}
        placeholder={t('taskDetail.replyPlaceholder')}
        type={'text'}
        variant={'chat'}
        onChange={(ed) => {
          setHasContent(!ed?.isEmpty);
        }}
        onPressEnter={({ event }) => {
          if (shouldSendOnEnter(event)) {
            handleSubmit();
            return true;
          }
        }}
      />
    </ChatInput>
  );
});

FeedbackInput.displayName = 'FeedbackInput';

export default FeedbackInput;
