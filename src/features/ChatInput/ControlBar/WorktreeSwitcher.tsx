import type { DeviceGitWorktreeListItem, WorkingDirEntry } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import {
  confirmModal,
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckIcon, GitForkIcon, Trash2Icon } from 'lucide-react';
import { memo, type MouseEvent, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { gitService } from '@/services/git';

import { useCommitWorkingDirectory } from './useCommitWorkingDirectory';

const styles = createStaticStyles(({ css }) => ({
  badge: css`
    flex: none;

    padding-block: 1px;
    padding-inline: 5px;
    border-radius: 999px;

    font-size: 11px;
    line-height: 15px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  branch: css`
    overflow: hidden;
    flex: 0 1 auto;

    min-width: 40px;
    max-width: 300px;

    font-size: 13px;
    line-height: 18px;
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
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 18px;

    color: ${cssVar.colorPrimary};
  `,
  actionCell: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 20px;
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
    gap: 3px;
    justify-content: flex-end;

    font-variant-numeric: tabular-nums;
    line-height: 1;
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
    grid-template-columns: minmax(0, 1fr) minmax(44px, auto) 20px;
    gap: 10px;
    align-items: center;

    min-height: 48px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: 8px;

    font-size: 13px;
    color: ${cssVar.colorText};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:hover .worktree-row-action {
      display: flex;
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
  dirtyCell: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: flex-end;

    min-width: 44px;
  `,
  list: css`
    overflow-y: auto;
    max-height: 360px;
    padding: 6px;
  `,
  name: css`
    overflow: hidden;
    flex: 0 1 auto;

    max-width: 240px;

    font-size: 13px;
    font-weight: 400;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  path: css`
    overflow: hidden;

    margin-block-start: 1px;

    font-size: 11px;
    line-height: 16px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rowTitle: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: center;

    min-width: 0;

    white-space: nowrap;
  `,
  rowAction: css`
    cursor: pointer;

    display: none;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorError};
      background: ${cssVar.colorErrorBg};
    }
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
  triggerAnchor: css`
    display: inline-flex;
    flex: none;
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

const normalizeDisplayPath = (path: string): string =>
  path.replaceAll('\\', '/').replace(/\/+$/, '');

const TEMP_PATH_PREFIXES = ['/tmp', '/var/tmp', '/private/tmp'];

const isTempPath = (path: string): boolean => {
  const normalized = normalizeDisplayPath(path);
  return TEMP_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
};

const getRelativeDisplayPath = (targetPath: string, sourcePath: string): string => {
  if (!targetPath || !sourcePath || isTempPath(targetPath)) return targetPath;

  const target = normalizeDisplayPath(targetPath);
  const source = normalizeDisplayPath(sourcePath);
  if (!target.startsWith('/') || !source.startsWith('/')) return targetPath;
  if (target === source) return targetPath;

  const targetParts = target.split('/').filter(Boolean);
  const sourceParts = source.split('/').filter(Boolean);
  let commonLength = 0;
  while (
    commonLength < targetParts.length &&
    commonLength < sourceParts.length &&
    targetParts[commonLength] === sourceParts[commonLength]
  ) {
    commonLength += 1;
  }

  if (commonLength < 2) return targetPath;

  const parentSteps = Array.from({ length: sourceParts.length - commonLength }, () => '..');
  const relativeParts = [...parentSteps, ...targetParts.slice(commonLength)];

  return relativeParts.length > 0 ? relativeParts.join('/') : '.';
};

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

const canRemoveWorktree = (worktree: DeviceGitWorktreeListItem): boolean =>
  !!worktree.detached && !worktree.current && !worktree.locked && !isDisabled(worktree);

interface DirtyStatProps {
  status?: DeviceGitWorktreeListItem['status'];
}

const DirtyStat = memo<DirtyStatProps>(({ status }) => {
  if (!status || status.clean) return null;

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
  onWorktreesChange?: () => Promise<unknown> | unknown;
  path: string;
  sourcePath: string;
  worktrees: DeviceGitWorktreeListItem[];
}

const WorktreeSwitcher = memo<WorktreeSwitcherProps>(
  ({
    agentId,
    currentBranch,
    detached,
    deviceId,
    isGithub,
    onWorktreesChange,
    path,
    sourcePath,
    worktrees,
  }) => {
    const { t } = useTranslation('device');
    const { t: tCommon } = useTranslation('common');
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

    const handleRemoveWorktree = useCallback(
      (event: MouseEvent, worktree: DeviceGitWorktreeListItem) => {
        event.stopPropagation();
        setOpen(false);
        confirmModal({
          cancelText: tCommon('cancel'),
          content: t('workingDirectory.removeWorktreeConfirm', {
            name: getPathName(worktree.path),
          }),
          okButtonProps: { danger: true },
          okText: tCommon('delete'),
          onOk: async () => {
            const result = await gitService.removeGitWorktree({
              deviceId,
              path,
              worktreePath: worktree.path,
            });
            if (result.success) {
              message.success(t('workingDirectory.removeWorktreeSuccess'));
              await onWorktreesChange?.();
              return;
            }
            message.error(result.error || t('workingDirectory.removeWorktreeFailed'));
          },
          title: t('workingDirectory.removeWorktreeTitle'),
        });
      },
      [deviceId, onWorktreesChange, path, t, tCommon],
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
        <DropdownMenuTrigger className={styles.triggerAnchor}>
          <div>{open ? trigger : <Tooltip title={triggerTitle}>{trigger}</Tooltip>}</div>
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
                      const displayPath = getRelativeDisplayPath(worktree.path, sourcePath);
                      const disabled = isDisabled(worktree);
                      const removable = canRemoveWorktree(worktree);

                      return (
                        <DropdownMenuItem
                          aria-disabled={disabled}
                          className={styles.item}
                          closeOnClick={false}
                          data-current={worktree.current}
                          key={worktree.path}
                          onClick={() => void commitWorktree(worktree)}
                        >
                          <div className={styles.itemMain}>
                            <div className={styles.rowTitle}>
                              <span className={styles.name}>{getPathName(worktree.path)}</span>
                              <span className={styles.branch}>{branch}</span>
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
                            <div className={styles.path} title={worktree.path}>
                              {displayPath}
                            </div>
                          </div>
                          <div className={styles.dirtyCell}>
                            <DirtyStat status={worktree.status} />
                          </div>
                          <div className={styles.actionCell}>
                            {worktree.current ? (
                              <Icon className={styles.check} icon={CheckIcon} size={14} />
                            ) : (
                              removable && (
                                <Tooltip title={t('workingDirectory.removeWorktreeAction')}>
                                  <div
                                    aria-label={t('workingDirectory.removeWorktreeAction')}
                                    className={`${styles.rowAction} worktree-row-action`}
                                    role="button"
                                    onClick={(event) => handleRemoveWorktree(event, worktree)}
                                  >
                                    <Icon icon={Trash2Icon} size={13} />
                                  </div>
                                </Tooltip>
                              )
                            )}
                          </div>
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
