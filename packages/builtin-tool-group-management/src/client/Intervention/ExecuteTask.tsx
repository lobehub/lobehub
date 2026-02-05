'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Avatar, Flexbox, Tooltip } from '@lobehub/ui';
import { Input, InputNumber } from 'antd';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Clock } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import type { ExecuteTaskParams } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  agentCard: css`
    padding: 4px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillTertiary};
  `,
  agentDescription: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextSecondary};
  `,
  agentTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  container: css`
    padding-block: 12px;
    border-radius: ${cssVar.borderRadius};
  `,
  header: css`
    font-size: 14px;
    font-weight: 600;
  `,
  icon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  timeoutInput: css`
    width: 100px;
  `,
}));

const DEFAULT_TIMEOUT = 1_800_000; // 30 minutes

/**
 * ExecuteTask Intervention Component
 *
 * Allows users to review and modify the task description before execution.
 */
const ExecuteTaskIntervention = memo<BuiltinInterventionProps<ExecuteTaskParams>>(
  ({ args, onArgsChange, registerBeforeApprove }) => {
    const { t } = useTranslation('tool');

    // Get agent info from store
    const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
    const agent = useAgentGroupStore((s) =>
      args?.agentId && activeGroupId
        ? agentGroupSelectors.getAgentByIdFromGroup(activeGroupId, args.agentId)(s)
        : undefined,
    );

    // Local state
    const [instruction, setInstruction] = useState(args?.instruction || '');
    const [timeout, setTimeout] = useState(args?.timeout ?? DEFAULT_TIMEOUT);
    const [hasChanges, setHasChanges] = useState(false);

    // Sync local state when args change externally
    useEffect(() => {
      if (!hasChanges) {
        setInstruction(args?.instruction || '');
        setTimeout(args?.timeout ?? DEFAULT_TIMEOUT);
      }
    }, [args?.instruction, args?.timeout, hasChanges]);

    // Handle instruction change
    const handleInstructionChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
      setInstruction(e.target.value);
      setHasChanges(true);
    }, []);

    // Handle timeout change (minutes to milliseconds)
    const handleTimeoutChange = useCallback((value: number | null) => {
      if (value !== null) {
        setTimeout(value * 60 * 1000); // Convert minutes to milliseconds
        setHasChanges(true);
      }
    }, []);

    // Save changes before approval
    useEffect(() => {
      if (!registerBeforeApprove) return;

      const cleanup = registerBeforeApprove('executeTask', async () => {
        if (hasChanges && onArgsChange) {
          await onArgsChange({ ...args, instruction, timeout });
        }
      });

      return cleanup;
    }, [registerBeforeApprove, hasChanges, instruction, timeout, args, onArgsChange]);

    return (
      <Flexbox className={styles.container} gap={12}>
        {/* Header: Agent info + Timeout */}
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Flexbox horizontal align={'center'} flex={1} gap={12} style={{ minWidth: 0 }}>
            <Avatar
              avatar={agent?.avatar || '🤖'}
              background={agent?.backgroundColor || undefined}
              size={24}
              style={{ borderRadius: 8, flexShrink: 0 }}
            />
            <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
              <span className={styles.agentTitle}>
                {agent?.title || t('agentGroupManagement.executeTask.intervention.unknownAgent')}
              </span>
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8} style={{ flexShrink: 0 }}>
            <Tooltip title={t('agentGroupManagement.executeTask.intervention.timeout')}>
              <Clock size={14} />
            </Tooltip>
            <InputNumber
              className={styles.timeoutInput}
              max={120}
              min={1}
              size={'small'}
              suffix={t('agentGroupManagement.executeTask.intervention.timeoutUnit')}
              value={Math.round(timeout / 60_000)}
              variant={'filled'}
              onChange={handleTimeoutChange}
            />
          </Flexbox>
        </Flexbox>

        {/* Instruction input */}
        <Input.TextArea
          autoSize={{ maxRows: 10, minRows: 6 }}
          placeholder={t('agentGroupManagement.executeTask.intervention.taskPlaceholder')}
          value={instruction}
          onChange={handleInstructionChange}
        />
      </Flexbox>
    );
  },
  isEqual,
);

ExecuteTaskIntervention.displayName = 'ExecuteTaskIntervention';

export default ExecuteTaskIntervention;
