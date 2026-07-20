'use client';

import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { InfoIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

interface RunPriorityHintProps {
  agentId?: string;
}

/**
 * The "Run priority" hint shown in the top-right of the Model & Tools panel.
 * The tooltip is context-aware:
 * - Personal agent: agent-exclusive tools win over the user's tools.
 * - Workspace agent: the agent-scoped tools win, falling back to the
 *   workspace's user-scoped tools.
 */
const RunPriorityHint = memo<RunPriorityHintProps>(({ agentId }) => {
  const { t } = useTranslation('setting');
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const effectiveAgentId = agentId || activeAgentId || '';
  const isWorkspaceAgent = useAgentStore(agentByIdSelectors.isWorkspaceAgentById(effectiveAgentId));

  return (
    <Tooltip
      title={t(
        isWorkspaceAgent
          ? 'settingAgent.agentTools.priorityTooltipWorkspace'
          : 'settingAgent.agentTools.priorityTooltip',
      )}
    >
      <Flexbox
        horizontal
        align={'center'}
        gap={4}
        style={{ cursor: 'help', fontSize: 12, opacity: 0.55 }}
      >
        <Icon icon={InfoIcon} size={14} />
        {t('settingAgent.agentTools.priorityHint')}
      </Flexbox>
    </Tooltip>
  );
});

RunPriorityHint.displayName = 'RunPriorityHint';

export default RunPriorityHint;
