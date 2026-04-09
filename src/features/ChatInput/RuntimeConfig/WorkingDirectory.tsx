import { isDesktop } from '@lobechat/const';
import { Github } from '@lobehub/icons';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, XIcon } from 'lucide-react';
import { memo, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { addRecentDir, getRecentDirs, type RecentDirEntry, removeRecentDir } from './recentDirs';

const styles = createStaticStyles(({ css }) => ({
  chooseFolderItem: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};

    transition: background-color 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  dirItem: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  dirItemActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  dirName: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  dirPath: css`
    overflow: hidden;

    font-size: 11px;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  removeBtn: css`
    cursor: pointer;

    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextQuaternary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  sectionTitle: css`
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
}));

const renderDirIcon = (repoType?: 'git' | 'github'): ReactNode => {
  const iconStyle = { color: cssVar.colorTextTertiary, flex: 'none' as const };
  if (repoType === 'github') return <Github size={16} style={iconStyle} />;
  return (
    <Icon icon={repoType === 'git' ? GitBranchIcon : FolderIcon} size={16} style={iconStyle} />
  );
};

interface WorkingDirectoryContentProps {
  agentId: string;
  onClose?: () => void;
}

const WorkingDirectoryContent = memo<WorkingDirectoryContentProps>(({ agentId, onClose }) => {
  const { t } = useTranslation('plugin');

  const agentWorkingDirectory = useAgentStore((s) =>
    agentByIdSelectors.getAgentWorkingDirectoryById(agentId)(s),
  );
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const effectiveDir = topicWorkingDirectory || agentWorkingDirectory;

  const updateAgentRuntimeEnvConfig = useAgentStore((s) => s.updateAgentRuntimeEnvConfigById);

  const [recentDirs, setRecentDirs] = useState(getRecentDirs);

  const displayDirs = useMemo(() => {
    const dirs = [...recentDirs];
    if (effectiveDir && !dirs.some((d) => d.path === effectiveDir)) {
      dirs.unshift({ path: effectiveDir });
    }
    return dirs;
  }, [recentDirs, effectiveDir]);

  const selectDir = useCallback(
    async (entry: RecentDirEntry) => {
      await updateAgentRuntimeEnvConfig(agentId, { workingDirectory: entry.path });
      setRecentDirs(addRecentDir(entry));
      onClose?.();
    },
    [agentId, updateAgentRuntimeEnvConfig, onClose],
  );

  const handleChooseFolder = useCallback(async () => {
    if (!isDesktop) return;
    const result = await electronSystemService.selectFolder({
      defaultPath: effectiveDir || undefined,
      title: t('localSystem.workingDirectory.selectFolder'),
    });
    if (result) {
      await selectDir({ path: result.path, repoType: result.repoType });
    }
  }, [effectiveDir, t, selectDir]);

  const handleRemoveRecent = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    setRecentDirs(removeRecentDir(path));
  }, []);

  const getDirName = (path: string) => path.split('/').findLast(Boolean) || path;

  return (
    <Flexbox gap={4} style={{ minWidth: 280 }}>
      <div className={styles.sectionTitle}>{t('localSystem.workingDirectory.recent')}</div>
      {displayDirs.length === 0 ? (
        <Flexbox
          align={'center'}
          justify={'center'}
          style={{ color: cssVar.colorTextQuaternary, fontSize: 12, padding: '12px 8px' }}
        >
          {t('localSystem.workingDirectory.noRecent')}
        </Flexbox>
      ) : (
        displayDirs.map((entry) => {
          const isActive = entry.path === effectiveDir;
          return (
            <Flexbox
              horizontal
              align={'center'}
              className={`${styles.dirItem} ${isActive ? styles.dirItemActive : ''}`}
              gap={8}
              key={entry.path}
              onClick={() => selectDir(entry)}
            >
              {renderDirIcon(entry.repoType)}
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <div className={styles.dirName}>{getDirName(entry.path)}</div>
                <div className={styles.dirPath}>{entry.path}</div>
              </Flexbox>
              {isActive ? (
                <Icon
                  icon={CheckIcon}
                  size={16}
                  style={{ color: cssVar.colorSuccess, flex: 'none' }}
                />
              ) : (
                <div
                  className={styles.removeBtn}
                  title={t('localSystem.workingDirectory.removeRecent')}
                  onClick={(e) => handleRemoveRecent(e, entry.path)}
                >
                  <Icon icon={XIcon} size={12} />
                </div>
              )}
            </Flexbox>
          );
        })
      )}

      {isDesktop && (
        <Flexbox
          horizontal
          align={'center'}
          className={styles.chooseFolderItem}
          gap={8}
          onClick={handleChooseFolder}
        >
          <Icon icon={FolderOpenIcon} size={14} />
          <span>{t('localSystem.workingDirectory.chooseDifferentFolder')}</span>
        </Flexbox>
      )}
    </Flexbox>
  );
});

WorkingDirectoryContent.displayName = 'WorkingDirectoryContent';

export default WorkingDirectoryContent;
