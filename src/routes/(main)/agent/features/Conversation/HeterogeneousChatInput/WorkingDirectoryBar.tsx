'use client';

import { Github } from '@lobehub/icons';
import { Flexbox, Icon, Popover, Skeleton, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ChevronDownIcon,
  CircleAlertIcon,
  FolderIcon,
  GitBranchIcon,
  SquircleDashed,
} from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import GitStatus from '@/features/ChatInput/RuntimeConfig/GitStatus';
import { useRepoType } from '@/features/ChatInput/RuntimeConfig/useRepoType';
import WorkingDirectoryContent from '@/features/ChatInput/RuntimeConfig/WorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    padding-block: 0;
    padding-inline: 4px;
  `,
  button: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
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
  const { t } = useTranslation('plugin');
  const { t: tChat } = useTranslation('chat');
  const agentId = useAgentId();
  const [open, setOpen] = useState(false);

  const isLoading = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));
  const agentWorkingDirectory = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgentWorkingDirectoryById(agentId)(s) : undefined,
  );
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const effectiveWorkingDirectory = topicWorkingDirectory || agentWorkingDirectory;

  const repoType = useRepoType(effectiveWorkingDirectory);

  const dirIconNode = useMemo((): ReactNode => {
    if (!effectiveWorkingDirectory) return <Icon icon={SquircleDashed} size={14} />;
    if (repoType === 'github') return <Github size={14} />;
    if (repoType === 'git') return <Icon icon={GitBranchIcon} size={14} />;
    return <Icon icon={FolderIcon} size={14} />;
  }, [effectiveWorkingDirectory, repoType]);

  if (!agentId || isLoading) {
    return (
      <Flexbox horizontal align={'center'} className={styles.bar} gap={4} justify={'space-between'}>
        <Skeleton.Button active size="small" style={{ height: 22, minWidth: 100, width: 100 }} />
        <Skeleton.Button active size="small" style={{ height: 22, minWidth: 80, width: 80 }} />
      </Flexbox>
    );
  }

  const displayName = effectiveWorkingDirectory
    ? effectiveWorkingDirectory.split('/').findLast(Boolean) || effectiveWorkingDirectory
    : t('localSystem.workingDirectory.notSet');

  const dirButton = (
    <div className={styles.button}>
      {dirIconNode}
      <span>{displayName}</span>
      <Icon icon={ChevronDownIcon} size={12} />
    </div>
  );

  const fullAccessBadge = (
    <div className={styles.fullAccess}>
      <Icon icon={CircleAlertIcon} size={14} />
      <span>{tChat('heteroAgent.fullAccess.label')}</span>
    </div>
  );

  return (
    <Flexbox horizontal align={'center'} className={styles.bar} justify={'space-between'}>
      <Flexbox horizontal align={'center'} gap={4}>
        <Popover
          content={<WorkingDirectoryContent agentId={agentId} onClose={() => setOpen(false)} />}
          open={open}
          placement="bottomLeft"
          styles={{ content: { padding: 4 } }}
          trigger="click"
          onOpenChange={setOpen}
        >
          <div>
            {open ? (
              dirButton
            ) : (
              <Tooltip
                title={effectiveWorkingDirectory || t('localSystem.workingDirectory.notSet')}
              >
                {dirButton}
              </Tooltip>
            )}
          </div>
        </Popover>
        {effectiveWorkingDirectory && repoType && (
          <GitStatus isGithub={repoType === 'github'} path={effectiveWorkingDirectory} />
        )}
      </Flexbox>
      <Tooltip title={tChat('heteroAgent.fullAccess.tooltip')}>{fullAccessBadge}</Tooltip>
    </Flexbox>
  );
});

WorkingDirectoryBar.displayName = 'HeterogeneousWorkingDirectoryBar';

export default WorkingDirectoryBar;
