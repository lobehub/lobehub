'use client';

import type { CodexPermissionMode, HeterogeneousProviderConfig } from '@lobechat/types';
import { CODEX_PERMISSION_MODES, resolveCodexPermissionMode } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import { Select, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CircleAlertIcon, ShieldCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { agentRunSelectors } from '@/store/chat/selectors';

import { isCodexPermissionConfigurable } from './codexPermission';

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

export const CodexPermissionControl = ({
  agentId,
  canConfigure,
  isLocalExecution,
  provider,
}: CodexPermissionControlProps) => {
  const { t } = useTranslation('chat');
  const [saving, setSaving] = useState(false);
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const isRunning = useChatStore(agentRunSelectors.isCurrentSendMessageLoading);

  const permissionMode = resolveCodexPermissionMode({
    args: provider.args,
    permissionMode: provider.permissionMode,
  }).mode;
  const permissionConfigurable = isCodexPermissionConfigurable({
    agentId,
    canConfigure,
    isLocalExecution,
    saving,
  });
  const description = t(`heteroAgent.codexPermission.description.${permissionMode}`);
  const tooltip = !isLocalExecution
    ? `${description} ${t('heteroAgent.codexPermission.localOnly')}`
    : description;
  const options = [
    ...(['ask', 'auto-review', 'read-only', 'full-access'] as const).map((mode) => ({
      label: t(`heteroAgent.codexPermission.mode.${mode}`),
      title: t(`heteroAgent.codexPermission.description.${mode}`),
      value: mode,
    })),
    ...(permissionMode === 'custom'
      ? [
          {
            disabled: true,
            label: t('heteroAgent.codexPermission.mode.custom'),
            title: t('heteroAgent.codexPermission.description.custom'),
            value: 'custom' as const,
          },
        ]
      : []),
  ];

  const updatePermission = async (nextMode: CodexPermissionMode) => {
    if (!permissionConfigurable) return;

    try {
      setSaving(true);
      await updateAgentConfigById(agentId, {
        agencyConfig: {
          heterogeneousProvider: { ...provider, permissionMode: nextMode },
        },
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
        className={cx(styles.select, permissionMode === 'full-access' && styles.danger)}
        options={options}
        readOnly={!permissionConfigurable}
        size="small"
        value={permissionMode}
        variant="borderless"
        prefix={
          <Icon
            icon={permissionMode === 'full-access' ? CircleAlertIcon : ShieldCheckIcon}
            size={14}
          />
        }
        onChange={(selection) => {
          if (
            typeof selection === 'string' &&
            CODEX_PERMISSION_MODES.includes(selection as CodexPermissionMode)
          ) {
            void updatePermission(selection as CodexPermissionMode);
          }
        }}
      />
    </Tooltip>
  );
};
