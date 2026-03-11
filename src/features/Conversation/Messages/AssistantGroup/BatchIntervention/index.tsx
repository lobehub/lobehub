import { type ChatToolPayloadWithResult } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import BatchApprovalActions from './BatchApprovalActions';
import BatchToolItem from './BatchToolItem';

interface BatchInterventionProps {
  assistantMessageId: string;
  auditType: string;
  tools: ChatToolPayloadWithResult[];
}

const BatchIntervention = memo<BatchInterventionProps>(({ auditType, tools }) => {
  const { t } = useTranslation('chat');

  const toolMessageIds = tools
    .map((tool) => tool.result_msg_id)
    .filter((id): id is string => !!id && !id.startsWith('tmp_'));

  return (
    <Flexbox
      gap={8}
      style={{
        border: '1px solid var(--lobe-color-border)',
        borderRadius: 'var(--lobe-border-radius)',
        padding: 12,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500 }}>
        {t('tool.intervention.batchTitle', { count: tools.length })}
      </div>
      <Flexbox gap={4}>
        {tools.map((tool) => (
          <BatchToolItem key={tool.id} tool={tool} />
        ))}
      </Flexbox>
      <Divider dashed style={{ margin: '4px 0' }} />
      <BatchApprovalActions auditType={auditType} toolMessageIds={toolMessageIds} />
    </Flexbox>
  );
});

export default BatchIntervention;
