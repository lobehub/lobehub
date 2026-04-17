'use client';

import { Github } from '@lobehub/icons';
import { Flexbox, Icon, Popover, Skeleton, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDownIcon, FolderIcon, GitBranchIcon, SquircleDashed } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { getRecentDirs } from '@/features/ChatInput/RuntimeConfig/recentDirs';
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

    height: 28px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

const WorkingDirectoryBar = memo(() => {
  const { t } = useTranslation('plugin');
  const agentId = useAgentId();
  const [open, setOpen] = useState(false);

  const isLoading = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));
  const agentWorkingDirectory = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgentWorkingDirectoryById(agentId)(s) : undefined,
  );
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const effectiveWorkingDirectory = topicWorkingDirectory || agentWorkingDirectory;

  const dirIconNode = useMemo((): ReactNode => {
    if (!effectiveWorkingDirectory) return <Icon icon={SquircleDashed} size={14} />;
    const dirs = getRecentDirs();
    const match = dirs.find((d) => d.path === effectiveWorkingDirectory);
    if (match?.repoType === 'github') return <Github size={14} />;
    if (match?.repoType === 'git') return <Icon icon={GitBranchIcon} size={14} />;
    return <Icon icon={FolderIcon} size={14} />;
  }, [effectiveWorkingDirectory]);

  if (!agentId || isLoading) {
    return (
      <Flexbox horizontal align={'center'} className={styles.bar} gap={4}>
        <Skeleton.Button active size="small" style={{ height: 22, minWidth: 100, width: 100 }} />
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

  return (
    <Flexbox horizontal align={'center'} className={styles.bar}>
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
            <Tooltip title={effectiveWorkingDirectory || t('localSystem.workingDirectory.notSet')}>
              {dirButton}
            </Tooltip>
          )}
        </div>
      </Popover>
    </Flexbox>
  );
});

WorkingDirectoryBar.displayName = 'HeterogeneousWorkingDirectoryBar';

export default WorkingDirectoryBar;
