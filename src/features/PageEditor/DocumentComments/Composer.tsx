import { Avatar, Flexbox, TextArea } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { Send } from 'lucide-react';
import { nanoid } from 'nanoid';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { usePermission } from '@/hooks/usePermission';
import { useUserAvatar } from '@/hooks/useUserAvatar';

import type { DocumentCommentSubmitInput } from './optimistic';
import { styles } from './styles';

interface Draft {
  clientId: string;
  content: string;
}

interface ComposerProps {
  documentId: string;
  onSubmit: (input: DocumentCommentSubmitInput) => Promise<void>;
  onSuccess?: () => void;
  parentCommentId?: string;
}

const Composer = memo<ComposerProps>(({ documentId, onSubmit, onSuccess, parentCommentId }) => {
  const { t } = useTranslation('file');
  const workspaceId = useActiveWorkspaceId();
  const { allowed: canCreate } = usePermission('create_content');
  const avatar = useUserAvatar();
  const shouldSendOnEnter = useEnterToSend();
  const submittingRef = useRef(false);
  const [draft, setDraft] = useLocalStorageState<Draft>(
    `document-comment-draft:${workspaceId ?? 'personal'}:${documentId}:${parentCommentId ?? 'root'}`,
    { clientId: nanoid(), content: '' },
  );
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    const content = draft.content.trim();
    if (!workspaceId || !canCreate || !content || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    const submittedDraft = draft;
    setDraft({ clientId: nanoid(), content: '' });
    try {
      await onSubmit({ clientId: submittedDraft.clientId, content });
      onSuccess?.();
    } catch {
      setDraft((current) => (current.content ? current : submittedDraft));
      toast.error(t('pageEditor.comments.createFailed'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [canCreate, draft, onSubmit, onSuccess, setDraft, t, workspaceId]);

  if (!workspaceId || !canCreate || (submitting && parentCommentId)) return null;

  return (
    <Flexbox className={styles.composer} gap={8}>
      <Flexbox horizontal align={'flex-start'} gap={8}>
        <Avatar avatar={avatar} size={parentCommentId ? 28 : 32} />
        <TextArea
          autoFocus={Boolean(parentCommentId)}
          autoSize={{ maxRows: 8, minRows: parentCommentId ? 1 : 2 }}
          className={styles.textarea}
          maxLength={10_000}
          value={draft.content}
          variant={'borderless'}
          placeholder={
            parentCommentId
              ? t('pageEditor.comments.replyPlaceholder')
              : t('pageEditor.comments.placeholder')
          }
          onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key !== 'Enter' || !shouldSendOnEnter(event))
              return;
            event.preventDefault();
            void submit();
          }}
        />
      </Flexbox>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <span />
        <Button
          disabled={!draft.content.trim()}
          icon={<Send size={15} />}
          loading={submitting}
          size={'small'}
          type={'primary'}
          onClick={() => void submit()}
        >
          {parentCommentId
            ? t('pageEditor.comments.replyAction')
            : t('pageEditor.comments.publish')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

Composer.displayName = 'DocumentCommentComposer';

export default Composer;
