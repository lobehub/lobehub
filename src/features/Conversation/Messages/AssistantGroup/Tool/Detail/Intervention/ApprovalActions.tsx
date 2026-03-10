import { Button, DropdownMenu, Flexbox, Popover } from '@lobehub/ui';
import { Input, Space } from 'antd';
import { ChevronDown } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';

import { useConversationStore } from '../../../../../store';
import { useMessageAggregationContext } from '../../../../Contexts/MessageAggregationContext';
import { type ApprovalMode } from './index';

interface ApprovalActionsProps {
  apiName: string;
  approvalMode: ApprovalMode;
  identifier: string;
  messageId: string;
  /**
   * Callback to be called before approve action
   * Used to flush pending saves (e.g., debounced saves) from intervention components
   */
  onBeforeApprove?: () => void | Promise<void>;
  toolCallId: string;
}

const ApprovalActions = memo<ApprovalActionsProps>(
  ({ approvalMode, messageId, identifier, apiName, onBeforeApprove }) => {
    const { t } = useTranslation(['chat', 'common']);
    const [rejectReason, setRejectReason] = useState('');
    const [rejectPopoverOpen, setRejectPopoverOpen] = useState(false);
    const [rejectLoading, setRejectLoading] = useState(false);
    const [approveLoading, setApproveLoading] = useState(false);

    // Disable actions while message is still being created (temp ID)
    const isMessageCreating = messageId.startsWith('tmp_');

    const { assistantGroupId } = useMessageAggregationContext();
    const [approveToolCall, rejectToolCall, rejectAndContinueToolCall] = useConversationStore(
      (s) => [s.approveToolCall, s.rejectToolCall, s.rejectAndContinueToolCall],
    );
    const addToolToAllowList = useUserStore((s) => s.addToolToAllowList);

    const handleApprove = async (remember?: boolean) => {
      setApproveLoading(true);
      try {
        // 0. Flush pending saves from intervention components (e.g., debounced saves)
        if (onBeforeApprove) {
          await onBeforeApprove();
        }

        // 1. Update intervention status
        await approveToolCall(messageId, assistantGroupId);

        // 2. If remembered, add to allowList
        if (remember) {
          const toolKey = `${identifier}/${apiName}`;
          await addToolToAllowList(toolKey);
        }
      } finally {
        setApproveLoading(false);
      }
    };

    const handleReject = async (reason?: string) => {
      setRejectLoading(true);
      await rejectToolCall(messageId, reason);
      setRejectLoading(false);
      setRejectPopoverOpen(false);
      setRejectReason('');
    };

    const handleRejectAndContinue = async (reason?: string) => {
      setRejectLoading(true);
      await rejectAndContinueToolCall(messageId, reason);
      setRejectLoading(false);
      setRejectPopoverOpen(false);
      setRejectReason('');
    };

    return (
      <Flexbox horizontal gap={8}>
        <Popover
          open={rejectPopoverOpen}
          placement="bottomRight"
          trigger="click"
          content={
            <Flexbox gap={12} style={{ width: 400 }}>
              <Flexbox horizontal align={'center'} justify={'space-between'}>
                <div>{t('tool.intervention.rejectTitle')}</div>

                <Space>
                  <Button
                    color={'default'}
                    loading={rejectLoading}
                    size="small"
                    variant={'filled'}
                    onClick={() => handleReject(rejectReason)}
                  >
                    {t('tool.intervention.rejectOnly')}
                  </Button>
                  <Button
                    loading={rejectLoading}
                    size="small"
                    type="primary"
                    onClick={() => handleRejectAndContinue(rejectReason)}
                  >
                    {t('tool.intervention.rejectAndContinue')}
                  </Button>
                </Space>
              </Flexbox>
              <Input.TextArea
                autoFocus
                placeholder={t('tool.intervention.rejectReasonPlaceholder')}
                rows={3}
                value={rejectReason}
                variant={'filled'}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </Flexbox>
          }
          onOpenChange={(open) => {
            if (rejectLoading) return;

            setRejectPopoverOpen(open);
          }}
        >
          <Button color={'default'} disabled={isMessageCreating} size="small" variant={'filled'}>
            {t('tool.intervention.reject')}
          </Button>
        </Popover>

        {approvalMode === 'allow-list' ? (
          <Space.Compact>
            <Button
              disabled={isMessageCreating}
              loading={approveLoading}
              size="small"
              type="primary"
              onClick={() => handleApprove(true)}
            >
              {t('tool.intervention.approveAndRemember')}
            </Button>
            <DropdownMenu
              items={[
                {
                  disabled: approveLoading || isMessageCreating,
                  key: 'once',
                  label: t('tool.intervention.approveOnce'),
                  onClick: () => handleApprove(false),
                },
              ]}
            >
              <Button
                disabled={approveLoading || isMessageCreating}
                icon={ChevronDown}
                size="small"
                type="primary"
              />
            </DropdownMenu>
          </Space.Compact>
        ) : (
          <Button
            disabled={isMessageCreating}
            loading={approveLoading}
            size="small"
            type="primary"
            onClick={() => handleApprove()}
          >
            {t('tool.intervention.approve')}
          </Button>
        )}
      </Flexbox>
    );
  },
);

export default ApprovalActions;
