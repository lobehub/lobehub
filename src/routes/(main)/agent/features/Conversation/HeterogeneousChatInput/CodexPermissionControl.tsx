'use client';

import type { CodexPermissionMode, HeterogeneousProviderConfig } from '@lobechat/types';
import { CODEX_PERMISSION_MODES, resolveCodexPermissionMode } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import { Select, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CircleAlertIcon, ShieldCheckIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { agentRunSelectors, topicSelectors } from '@/store/chat/selectors';

import {
  AGENT_DEFAULT_VALUE,
  type CodexPermissionSelection,
  persistCodexPermissionSelection,
} from './codexPermission';

const styles = createStaticStyles(({ css }) => ({
  danger: css`
    color: ${cssVar.colorWarning};
    background: color-mix(in srgb, ${cssVar.colorWarningBg} 55%, transparent);
  `,
  select: css`
    min-width: 126px;
    font-size: 12px;
  `,
}));

interface CodexPermissionControlProps {
  agentId: string;
  canConfigure: boolean;
  isLocalExecution: boolean;
  provider: HeterogeneousProviderConfig;
}

const CodexPermissionControl = memo<CodexPermissionControlProps>(
  ({ agentId, canConfigure, isLocalExecution, provider }) => {
    const { t } = useTranslation('chat');
    const [saving, setSaving] = useState(false);
    const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
    const activeTopicId = useChatStore((s) => s.activeTopicId);
    const topicPermissionMode = useChatStore(
      (s) => topicSelectors.currentTopicMetadata(s)?.codexPermissionMode,
    );
    const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);
    const isRunning = useChatStore(agentRunSelectors.isCurrentSendMessageLoading);

    const agentDefault = resolveCodexPermissionMode({
      args: provider.args,
      permissionMode: provider.permissionMode,
    }).mode;
    const effectiveMode = resolveCodexPermissionMode({
      args: provider.args,
      permissionMode: provider.permissionMode,
      topicPermissionMode,
    }).mode;
    const value = topicPermissionMode ?? AGENT_DEFAULT_VALUE;
    const readOnly = !agentId || !canConfigure || saving;
    const description = t(`heteroAgent.codexPermission.description.${effectiveMode}`);
    const tooltip = !isLocalExecution
      ? `${description} ${t('heteroAgent.codexPermission.localOnly')}`
      : !activeTopicId
        ? `${description} ${t('heteroAgent.codexPermission.noTopic')}`
        : description;
    const options = [
      {
        label: t('heteroAgent.codexPermission.agentDefault', {
          mode: t(`heteroAgent.codexPermission.mode.${agentDefault}`),
        }),
        value: AGENT_DEFAULT_VALUE,
      },
      ...(['ask', 'auto-review', 'read-only', 'full-access'] as const).map((mode) => ({
        label: t(`heteroAgent.codexPermission.mode.${mode}`),
        title: t(`heteroAgent.codexPermission.description.${mode}`),
        value: mode,
      })),
    ];

    const updatePermission = async (selection: CodexPermissionSelection) => {
      if (!agentId || !canConfigure || saving) return;

      try {
        setSaving(true);
        await persistCodexPermissionSelection({
          activeTopicId,
          selection,
          updateAgentPermissionMode: (permissionMode) =>
            updateAgentConfigById(agentId, {
              agencyConfig: {
                heterogeneousProvider: { ...provider, permissionMode },
              },
            }),
          updateTopicPermissionMode: (topicId, permissionMode) =>
            updateTopicMetadata(topicId, { codexPermissionMode: permissionMode }),
        });
        if (isRunning) toast.info(t('heteroAgent.codexPermission.nextRun'));
      } catch (error) {
        console.error('[CodexPermissionControl] Failed to update permission mode:', error);
        toast.error(t('heteroAgent.codexPermission.updateFailed'));
      } finally {
        setSaving(false);
      }
    };

    return (
      <Tooltip title={tooltip}>
        <Select
          className={cx(styles.select, effectiveMode === 'full-access' && styles.danger)}
          options={options}
          readOnly={readOnly}
          size="small"
          value={value}
          variant="borderless"
          prefix={
            <Icon
              icon={effectiveMode === 'full-access' ? CircleAlertIcon : ShieldCheckIcon}
              size={14}
            />
          }
          onChange={(selection) => {
            if (
              typeof selection === 'string' &&
              (selection === AGENT_DEFAULT_VALUE ||
                CODEX_PERMISSION_MODES.includes(selection as CodexPermissionMode))
            ) {
              void updatePermission(selection as CodexPermissionSelection);
            }
          }}
        />
      </Tooltip>
    );
  },
);

CodexPermissionControl.displayName = 'CodexPermissionControl';

export default CodexPermissionControl;
