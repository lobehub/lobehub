import { getBuiltinIntervention } from '@lobechat/builtin-tools/interventions';
import { type ChatToolPayloadWithResult } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import { AccordionItem, Button, Flexbox } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../store';
import { useMessageAggregationContext } from '../../Contexts/MessageAggregationContext';

interface BatchToolItemProps {
  tool: ChatToolPayloadWithResult;
}

const BatchToolItem = memo<BatchToolItemProps>(({ tool }) => {
  const { t } = useTranslation('chat');
  const { assistantGroupId } = useMessageAggregationContext();
  const [approveToolCall, rejectToolCall] = useConversationStore((s) => [
    s.approveToolCall,
    s.rejectToolCall,
  ]);
  const [loading, setLoading] = useState(false);
  const toolName = `${tool.identifier}/${tool.apiName}`;
  const parsedArgs = useMemo(() => safeParseJSON(tool.arguments || '') ?? {}, [tool.arguments]);

  const BuiltinIntervention = getBuiltinIntervention(tool.identifier, tool.apiName);

  const isMessageCreating = !tool.result_msg_id || tool.result_msg_id.startsWith('tmp_');

  const handleApprove = async () => {
    if (isMessageCreating) return;
    setLoading(true);
    try {
      await approveToolCall(tool.result_msg_id!, assistantGroupId);
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (isMessageCreating) return;
    setLoading(true);
    try {
      await rejectToolCall(tool.result_msg_id!);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AccordionItem
      expand
      itemKey={tool.id}
      paddingBlock={4}
      paddingInline={8}
      title={<span style={{ fontSize: 13 }}>{toolName}</span>}
      action={
        <Flexbox horizontal gap={4}>
          <Button
            color="default"
            disabled={loading || isMessageCreating}
            size="small"
            variant="text"
            onClick={handleReject}
          >
            {t('tool.intervention.reject')}
          </Button>
          <Button
            disabled={isMessageCreating}
            loading={loading}
            size="small"
            type="primary"
            variant="text"
            onClick={handleApprove}
          >
            {t('tool.intervention.approve')}
          </Button>
        </Flexbox>
      }
    >
      {BuiltinIntervention ? (
        <BuiltinIntervention
          apiName={tool.apiName}
          args={parsedArgs}
          identifier={tool.identifier}
          messageId={tool.result_msg_id || ''}
        />
      ) : (
        <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(parsedArgs, null, 2)}
        </pre>
      )}
    </AccordionItem>
  );
});

export default BatchToolItem;
