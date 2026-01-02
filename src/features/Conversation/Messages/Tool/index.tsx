import { type UIChatMessage } from '@lobechat/types';
import { Alert, Button, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { dataSelectors, useConversationStore } from '../../store';
import Tool from './Tool';

interface ToolMessageProps {
  id: string;
  index: number;
}

const ToolMessage = memo<ToolMessageProps>(({ id, index }) => {
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
      <Alert
        action={
          <Button loading={loading} onClick={handleDelete} size={'small'} type={'primary'}>
            {t('inspector.delete')}
          </Button>
        }
        title={t('inspector.orphanedToolCall')}
        type={'secondary'}
      />
      {item.plugin && (
        <Tool {...item.plugin} index={index} messageId={id} toolCallId={item.tool_call_id!} />
      )}
    </Flexbox>
  );
}, isEqual);

export default ToolMessage;
