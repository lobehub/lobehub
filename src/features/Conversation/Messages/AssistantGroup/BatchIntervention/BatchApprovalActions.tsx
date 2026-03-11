import { Button, Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { useConversationStore } from '../../../store';
import { useMessageAggregationContext } from '../../Contexts/MessageAggregationContext';

interface BatchApprovalActionsProps {
  auditType: string;
  toolMessageIds: string[];
}

const BatchApprovalActions = memo<BatchApprovalActionsProps>(({ auditType, toolMessageIds }) => {
  const { t } = useTranslation('chat');
  const { assistantGroupId } = useMessageAggregationContext();
  const [loading, setLoading] = useState<string | null>(null);

  const approveAllToolCallings = useChatStore((s) => s.approveAllToolCallings);
  const bypassAuditForSession = useChatStore((s) => s.bypassAuditForSession);
  const rejectToolCall = useConversationStore((s) => s.rejectToolCall);
  const context = useConversationStore((s) => s.context);

  const handleApproveAll = async () => {
    setLoading('approveAll');
    try {
      await approveAllToolCallings(toolMessageIds, assistantGroupId, context);
    } finally {
      setLoading(null);
    }
  };

  const handleRejectAll = async () => {
    setLoading('rejectAll');
    try {
      for (const id of toolMessageIds) {
        await rejectToolCall(id);
      }
    } finally {
      setLoading(null);
    }
  };

  const handleAllowSession = async () => {
    setLoading('allowSession');
    try {
      bypassAuditForSession(auditType);
      await approveAllToolCallings(toolMessageIds, assistantGroupId, context);
    } finally {
      setLoading(null);
    }
  };

  const isAnyLoading = loading !== null;

  return (
    <Flexbox horizontal gap={8} justify="flex-end">
      <Button
        color="default"
        disabled={isAnyLoading}
        loading={loading === 'rejectAll'}
        size="small"
        variant="filled"
        onClick={handleRejectAll}
      >
        {t('tool.intervention.rejectAll')}
      </Button>
      <Button
        disabled={isAnyLoading}
        loading={loading === 'approveAll'}
        size="small"
        type="primary"
        variant="outlined"
        onClick={handleApproveAll}
      >
        {t('tool.intervention.approveAll')}
      </Button>
      <Button
        disabled={isAnyLoading}
        loading={loading === 'allowSession'}
        size="small"
        type="primary"
        onClick={handleAllowSession}
      >
        {t('tool.intervention.allowSession')}
      </Button>
    </Flexbox>
  );
});

export default BatchApprovalActions;
