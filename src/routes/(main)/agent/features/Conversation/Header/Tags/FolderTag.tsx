import { Github } from '@lobehub/icons';
import { Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FolderIcon, GitBranchIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { getRecentDirs } from '@/features/ChatInput/RuntimeConfig/recentDirs';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    height: 22px;
    padding-inline: 8px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  label: css`
    overflow: hidden;
    max-width: 200px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const FolderTag = memo(() => {
  const { t } = useTranslation('tool');

  const topicBoundDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);

  const iconNode = useMemo((): ReactNode => {
    if (!topicBoundDirectory) return null;
    const match = getRecentDirs().find((d) => d.path === topicBoundDirectory);
    if (match?.repoType === 'github') return <Github size={12} />;
    if (match?.repoType === 'git') return <Icon icon={GitBranchIcon} size={12} />;
    return <Icon icon={FolderIcon} size={12} />;
  }, [topicBoundDirectory]);

  if (!isDesktop || !topicBoundDirectory) return null;

  const displayName = topicBoundDirectory.split('/').findLast(Boolean) || topicBoundDirectory;

  const handleOpen = () => {
    void localFileService.openLocalFolder({ isDirectory: true, path: topicBoundDirectory });
  };

  return (
    <Tooltip title={`${topicBoundDirectory} · ${t('localFiles.openFolder')}`}>
      <div className={styles.chip} onClick={handleOpen}>
        {iconNode}
        <span className={styles.label}>{displayName}</span>
      </div>
    </Tooltip>
  );
});

FolderTag.displayName = 'TopicFolderTag';

export default FolderTag;
