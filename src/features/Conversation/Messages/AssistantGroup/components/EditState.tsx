import { Flexbox } from '@lobehub/ui';
import { MessageInput } from '@lobehub/ui/chat';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../store';

export interface EditStateProps {
  content: string;
  id: string;
}

const EditState = memo<EditStateProps>(({ id, content }) => {
  const { t } = useTranslation('common');

  const text = useMemo(
    () => ({
      cancel: t('cancel'),
      confirm: t('ok'),
      edit: t('edit'),
    }),
    [],
  );

  const [toggleMessageEditing, updateMessageContent] = useConversationStore((s) => [
    s.toggleMessageEditing,
    s.modifyMessageContent,
  ]);

  const onEditingChange = (value: string) => {
    updateMessageContent(id, value);
    toggleMessageEditing(id, false);
  };

  return (
    <Flexbox paddingBlock={'0 8px'}>
      <MessageInput
        defaultValue={content ? String(content) : ''}
        editButtonSize={'small'}
        onCancel={() => {
          toggleMessageEditing(id, false);
        }}
        onConfirm={onEditingChange}
        text={text}
        variant={'outlined'}
      />
    </Flexbox>
  );
});

export default EditState;
