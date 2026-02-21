import { type UIChatMessage } from '@lobechat/types';
import { Alert, Button, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { dataSelectors, useConversationStore } from '../../store';
import Tool from './Tool';

interface ToolMessageProps {
  disableEditing?: boolean;
  id: string;
  index: number;
}

const ToolMessage = memo<ToolMessageProps>(({ disableEditing, id, index }) => {
  const { t } = useTranslation('plugin');
  const item = useConversationStore(dataSelectors.getDbMessageById(id), isEqual) as UIChatMessage;
  const deleteToolMessage = useConversationStore((s) => s.deleteToolMessage);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      await deleteToolMessage(id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={4} paddingBlock={12}>
      {!disableEditing && (
        <Alert
          title={t('inspector.orphanedToolCall')}
          type={'secondary'}
          action={
            <Button loading={loading} size={'small'} type={'primary'} onClick={handleDelete}>
              {t('inspector.delete')}
            </Button>
          }
        />
      )}
      {item.plugin && (
        <Tool
          {...item.plugin}
          disableEditing={disableEditing}
          index={index}
          messageId={id}
          toolCallId={item.tool_call_id!}
        />
      )}
    </Flexbox>
  );
}, isEqual);

export default ToolMessage;
