'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, Icon, Skeleton, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleAlertIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import WorkspaceControls from '@/features/ChatInput/RuntimeConfig/WorkspaceControls';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    padding-block: 0;
    padding-inline: 4px;
  `,
  fullAccess: css`
    cursor: default;

    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const WorkingDirectoryBar = memo(() => {
  const { t: tChat } = useTranslation('chat');
  const agentId = useAgentId();

  // All hooks must be called unconditionally (Rules of Hooks)
  const isLoading = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));

  // On web there's no full-access badge / skeleton — just the workspace controls
  // (the cloud repo switcher is rendered inside WorkspaceControls).
  if (!isDesktop) {
    if (!agentId) return null;
    return (
      <Flexbox horizontal align={'center'} className={styles.bar} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={4}>
          <WorkspaceControls alwaysShowWorkspace agentId={agentId} />
        </Flexbox>
      </Flexbox>
    );
  }

  if (!agentId || isLoading) {
    return (
      <Flexbox horizontal align={'center'} className={styles.bar} gap={4} justify={'space-between'}>
        <Skeleton.Button active size="small" style={{ height: 22, minWidth: 100, width: 100 }} />
        <Skeleton.Button active size="small" style={{ height: 22, minWidth: 80, width: 80 }} />
      </Flexbox>
    );
  }

  const fullAccessBadge = (
    <div className={styles.fullAccess}>
      <Icon icon={CircleAlertIcon} size={14} />
      <span>{tChat('heteroAgent.fullAccess.label')}</span>
    </div>
  );

  return (
    <Flexbox horizontal align={'center'} className={styles.bar} justify={'space-between'}>
      <Flexbox horizontal align={'center'} gap={4}>
        <WorkspaceControls alwaysShowWorkspace agentId={agentId} />
      </Flexbox>
      <Tooltip title={tChat('heteroAgent.fullAccess.tooltip')}>{fullAccessBadge}</Tooltip>
    </Flexbox>
  );
});

WorkingDirectoryBar.displayName = 'HeterogeneousWorkingDirectoryBar';

export default WorkingDirectoryBar;
