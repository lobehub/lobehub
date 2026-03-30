'use client';

import { Button, copyToClipboard } from '@lobehub/ui';
import { App } from 'antd';
import { LogsIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ShareDataProvider, { useShareData } from '@/features/ShareModal/ShareDataProvider';
import { generateMarkdown } from '@/features/ShareModal/ShareText/template';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

interface DebugExportButtonContentProps {
  agentId: string;
}

interface DebugExportButtonProps {
  agentId: string;
  topicId: string;
}

const DEBUG_EXPORT_FIELDS = {
  includeTool: true,
  includeUser: true,
  withRole: true,
  withSystemRole: true,
} as const;

const DebugExportButtonContent = memo<DebugExportButtonContentProps>(({ agentId }) => {
  const { t } = useTranslation(['common', 'onboarding']);
  const { message } = App.useApp();
  const { dbMessages, isLoading, title } = useShareData();
  const systemRole = useAgentStore(agentByIdSelectors.getAgentSystemRoleById(agentId));

  const content = useMemo(
    () =>
      generateMarkdown({
        ...DEBUG_EXPORT_FIELDS,
        messages: dbMessages,
        systemRole: systemRole ?? '',
        title,
      }).replaceAll('\n\n\n', '\n'),
    [dbMessages, systemRole, title],
  );

  const disabled = isLoading || dbMessages.length === 0;

  return (
    <Button
      disabled={disabled}
      icon={<LogsIcon size={14} />}
      loading={isLoading}
      size={'small'}
      onClick={async () => {
        try {
          await copyToClipboard(content);
          message.success(t('copySuccess', { ns: 'common' }));
        } catch (error) {
          console.error('Failed to copy onboarding debug export:', error);
        }
      }}
    >
      {t('agent.modeSwitch.debug', { ns: 'onboarding' })}
    </Button>
  );
});

DebugExportButtonContent.displayName = 'DebugExportButtonContent';

const AgentOnboardingDebugExportButton = memo<DebugExportButtonProps>(({ agentId, topicId }) => {
  if (!agentId || !topicId) return null;

  return (
    <ShareDataProvider context={{ agentId, topicId }}>
      <DebugExportButtonContent agentId={agentId} />
    </ShareDataProvider>
  );
});

AgentOnboardingDebugExportButton.displayName = 'AgentOnboardingDebugExportButton';

export default AgentOnboardingDebugExportButton;
