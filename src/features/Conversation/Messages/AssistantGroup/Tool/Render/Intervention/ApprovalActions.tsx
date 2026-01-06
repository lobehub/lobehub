import { Button, Dropdown, Flexbox } from '@lobehub/ui';
import { Input, Popover, Space } from 'antd';
import { ChevronDown } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';

import { useConversationStore } from '../../../../../store';
import { useGroupMessage } from '../../../components/GroupContext';
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

    const { assistantGroupId } = useGroupMessage();
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
      <Flexbox gap={8} horizontal>
        <Popover
          arrow={false}
          content={
            <Flexbox gap={12} style={{ width: 400 }}>
              <Flexbox align={'center'} horizontal justify={'space-between'}>
                <div>{t('tool.intervention.rejectTitle')}</div>

                <Space>
                  <Button
                    color={'default'}
                    loading={rejectLoading}
                    onClick={() => handleReject(rejectReason)}
                    size="small"
                    variant={'filled'}
                  >
                    {t('tool.intervention.rejectOnly')}
                  </Button>
                  <Button
                    loading={rejectLoading}
                    onClick={() => handleRejectAndContinue(rejectReason)}
                    size="small"
                    type="primary"
                  >
                    {t('tool.intervention.rejectAndContinue')}
                  </Button>
                </Space>
              </Flexbox>
              <Input.TextArea
                autoFocus
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t('tool.intervention.rejectReasonPlaceholder')}
                rows={3}
                value={rejectReason}
                variant={'filled'}
              />
            </Flexbox>
          }
          onOpenChange={(open) => {
            if (rejectLoading) return;

            setRejectPopoverOpen(open);
          }}
          open={rejectPopoverOpen}
          placement="bottomRight"
          trigger="click"
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
              onClick={() => handleApprove(true)}
              size="small"
              type="primary"
            >
              {t('tool.intervention.approveAndRemember')}
            </Button>
            <Dropdown
              menu={{
                items: [
                  {
                    disabled: approveLoading || isMessageCreating,
                    key: 'once',
                    label: t('tool.intervention.approveOnce'),
                    onClick: () => handleApprove(false),
                  },
                ],
              }}
            >
              <Button
                disabled={approveLoading || isMessageCreating}
                icon={ChevronDown}
                size="small"
                type="primary"
              />
            </Dropdown>
          </Space.Compact>
        ) : (
          <Button
            disabled={isMessageCreating}
            loading={approveLoading}
            onClick={() => handleApprove()}
            size="small"
            type="primary"
          >
            {t('tool.intervention.approve')}
          </Button>
        )}
      </Flexbox>
    );
  },
);

export default ApprovalActions;
