import type { DeviceGitWorktreeListItem, WorkingDirEntry } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import {
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckIcon, GitForkIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommitWorkingDirectory } from './useCommitWorkingDirectory';

const styles = createStaticStyles(({ css }) => ({
  badge: css`
    flex: none;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 999px;

    font-size: 11px;
    line-height: 16px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  branch: css`
    overflow: hidden;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  branchInline: css`
    overflow: hidden;

    min-width: 28px;
    max-width: 220px;

    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  check: css`
    flex: none;
    width: 18px;
    color: ${cssVar.colorPrimary};
  `,
  clean: css`
    color: ${cssVar.colorSuccess};
  `,
  container: css`
    display: flex;
    flex-direction: column;

    width: 520px;
    max-width: calc(100vw - 48px);
    margin: -4px;
  `,
  count: css`
    flex: none;

    padding-inline: 5px;
    border-radius: 999px;

    font-size: 11px;
    line-height: 16px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillSecondary};
  `,
  diffStat: css`
    display: inline-flex;
    flex: none;
    gap: 4px;
    justify-content: flex-end;

    min-width: 54px;

    font-variant-numeric: tabular-nums;
  `,
  diffStatAdded: css`
    color: ${cssVar.colorSuccess};
  `,
  diffStatDeleted: css`
    color: ${cssVar.colorError};
  `,
  diffStatModified: css`
    color: ${cssVar.colorWarning};
  `,
  emptyState: css`
    padding-block: 16px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  header: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorSplit};
  `,
  headerMeta: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
  `,
  headerSubtitle: css`
    margin-block-start: 1px;
    color: ${cssVar.colorTextTertiary};
  `,
  headerTitle: css`
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  item: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;

    min-height: 62px;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: 8px;

    color: ${cssVar.colorText};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &[data-current='true'] {
      background: ${cssVar.colorFillSecondary};
    }

    &[aria-disabled='true'] {
      cursor: not-allowed;
      opacity: 0.55;
    }
  `,
  itemMain: css`
    overflow: hidden;
    min-width: 0;
  `,
  list: css`
    overflow-y: auto;
    max-height: 360px;
    padding: 6px;
  `,
  name: css`
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  path: css`
    overflow: hidden;

    margin-block-start: 2px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rowTitle: css`
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  `,
  trigger: css`
    cursor: pointer;

    display: inline-flex;
    flex: none;
    gap: 5px;
    align-items: center;

    max-width: 420px;
    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  worktreeName: css`
    overflow: hidden;
    max-width: 140px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const getPathName = (path: string): string =>
  path.replaceAll('\\', '/').split('/').findLast(Boolean) || path;

const getShortHead = (head?: string): string | undefined => head?.slice(0, 7);

const getWorktreeBranch = (
  worktree: DeviceGitWorktreeListItem,
  fallbackBranch: string,
  detachedLabel: (sha: string) => string,
): string => {
  if (worktree.branch) return worktree.branch;
  const head = getShortHead(worktree.head);
  if (worktree.detached && head) return detachedLabel(head);
  return fallbackBranch;
};

const isDisabled = (worktree: DeviceGitWorktreeListItem): boolean =>
  !!worktree.bare || !!worktree.prunable;

interface DirtyStatProps {
  status?: DeviceGitWorktreeListItem['status'];
}

const DirtyStat = memo<DirtyStatProps>(({ status }) => {
  const { t } = useTranslation('device');
  if (!status)
    return <span className={styles.headerMeta}>{t('workingDirectory.worktreeUnavailable')}</span>;
  if (status.clean) return <span className={styles.clean}>{t('workingDirectory.clean')}</span>;

  return (
    <span className={styles.diffStat}>
      {status.added > 0 && <span className={styles.diffStatAdded}>+{status.added}</span>}
      {status.modified > 0 && <span className={styles.diffStatModified}>±{status.modified}</span>}
      {status.deleted > 0 && <span className={styles.diffStatDeleted}>-{status.deleted}</span>}
    </span>
  );
});

DirtyStat.displayName = 'DirtyStat';

interface WorktreeSwitcherProps {
  agentId: string;
  currentBranch: string;
  detached?: boolean;
  deviceId?: string;
  isGithub: boolean;
  path: string;
  sourcePath: string;
  worktrees: DeviceGitWorktreeListItem[];
}

const WorktreeSwitcher = memo<WorktreeSwitcherProps>(
  ({ agentId, currentBranch, detached, isGithub, path, sourcePath, worktrees }) => {
    const { t } = useTranslation('device');
    const [open, setOpen] = useState(false);
    const { commit } = useCommitWorkingDirectory(agentId);

    const currentWorktree = useMemo(
      () =>
        worktrees.find((worktree) => worktree.current) ?? worktrees.find((w) => w.path === path),
      [path, worktrees],
    );

    const currentPath = currentWorktree?.path ?? path;
    const currentName = getPathName(currentPath);
    const branchLabel = currentWorktree
      ? getWorktreeBranch(currentWorktree, currentBranch, (sha) =>
          t('workingDirectory.detachedHeadShort', { sha }),
        )
      : currentBranch;

    const commitWorktree = useCallback(
      async (worktree: DeviceGitWorktreeListItem) => {
        if (worktree.current || isDisabled(worktree)) {
          setOpen(false);
          return;
        }

        const entry: WorkingDirEntry = {
          ...(worktree.path === sourcePath ? {} : { git: { activeWorktree: worktree.path } }),
          path: sourcePath,
          repoType: isGithub ? 'github' : 'git',
        };
        await commit(entry);
        setOpen(false);
      },
      [commit, isGithub, sourcePath],
    );

    const triggerTitle = detached
      ? t('workingDirectory.detachedHead', { sha: currentBranch })
      : `${currentName} · ${branchLabel}`;

    const trigger = (
      <div className={styles.trigger}>
        <Icon icon={GitForkIcon} size={12} />
        <span className={styles.worktreeName}>{currentName}</span>
        <span className={styles.branchInline}>{branchLabel}</span>
        <span className={styles.count}>{worktrees.length}</span>
      </div>
    );

    return (
      <DropdownMenuRoot open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger>
          {open ? trigger : <Tooltip title={triggerTitle}>{trigger}</Tooltip>}
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner placement="topLeft" sideOffset={8}>
            <DropdownMenuPopup>
              <div className={styles.container}>
                <div className={styles.header}>
                  <div>
                    <div className={styles.headerTitle}>
                      {t('workingDirectory.worktreesHeading')}
                    </div>
                    <div className={styles.headerSubtitle}>
                      {t('workingDirectory.worktreeSwitchDescription')}
                    </div>
                  </div>
                  <div className={styles.headerMeta}>
                    {t('workingDirectory.worktreeCount', { count: worktrees.length })}
                  </div>
                </div>

                <div className={styles.list}>
                  {worktrees.length === 0 ? (
                    <div className={styles.emptyState}>{t('workingDirectory.worktreesEmpty')}</div>
                  ) : (
                    worktrees.map((worktree) => {
                      const branch = getWorktreeBranch(worktree, currentBranch, (sha) =>
                        t('workingDirectory.detachedHeadShort', { sha }),
                      );
                      const disabled = isDisabled(worktree);

                      return (
                        <DropdownMenuItem
                          aria-disabled={disabled}
                          className={styles.item}
                          closeOnClick={false}
                          data-current={worktree.current}
                          key={worktree.path}
                          onClick={() => void commitWorktree(worktree)}
                        >
                          <div className={styles.check}>
                            {worktree.current && <Icon icon={CheckIcon} size={14} />}
                          </div>
                          <div className={styles.itemMain}>
                            <div className={styles.rowTitle}>
                              <span className={styles.name}>{getPathName(worktree.path)}</span>
                              {worktree.current && (
                                <span className={styles.badge}>
                                  {t('workingDirectory.currentWorktree')}
                                </span>
                              )}
                              {worktree.detached && (
                                <span className={styles.badge}>
                                  {t('workingDirectory.detachedWorktree')}
                                </span>
                              )}
                              {worktree.locked && (
                                <span className={styles.badge}>
                                  {t('workingDirectory.lockedWorktree')}
                                </span>
                              )}
                              {worktree.prunable && (
                                <span className={styles.badge}>
                                  {t('workingDirectory.prunableWorktree')}
                                </span>
                              )}
                              {worktree.bare && (
                                <span className={styles.badge}>
                                  {t('workingDirectory.bareWorktree')}
                                </span>
                              )}
                            </div>
                            <div className={styles.branch}>{branch}</div>
                            <div className={styles.path}>{worktree.path}</div>
                          </div>
                          <DirtyStat status={worktree.status} />
                        </DropdownMenuItem>
                      );
                    })
                  )}
                </div>
              </div>
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    );
  },
);

WorktreeSwitcher.displayName = 'WorktreeSwitcher';

export default WorktreeSwitcher;
