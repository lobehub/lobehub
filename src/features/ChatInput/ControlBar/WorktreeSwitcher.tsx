import {
  deriveWorktreePath,
  type DeviceGitWorktreeListItem,
  type WorkingDirEntry,
} from '@lobechat/types';
import { Icon, Input, Tooltip } from '@lobehub/ui';
import {
  confirmModal,
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  toast,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  CheckIcon,
  FolderPlusIcon,
  GitForkIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { gitService } from '@/services/git';

import { openCreateWorktreeModal } from './CreateWorktreeModal';
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

    width: 460px;
    max-width: calc(100vw - 48px);
    height: 380px;

    /* Cancel DropdownMenuPopup's default 4px padding so our sections align edge-to-edge */
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
  searchBar: css`
    padding-block: 4px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    .ant-input-affix-wrapper {
      padding-inline: 0;
    }

    .ant-input-prefix {
      margin-inline-end: 8px;
    }
  `,
  section: css`
    flex: 1;
    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  sectionRow: css`
    display: flex;
    gap: 4px;
    align-items: center;

    padding-block: 4px 2px;
    padding-inline: 8px;
  `,
  refreshButton: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  spinning: css`
    animation: worktree-switcher-spin 0.8s linear infinite;

    @keyframes worktree-switcher-spin {
      to {
        transform: rotate(360deg);
      }
    }
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
    flex: 1;
    padding: 6px;
  `,
  createItemWrapper: css`
    padding: 6px;
    border-block-start: 1px solid ${cssVar.colorSplit};
  `,
  createItem: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: 8px;

    font-size: 13px;
    color: ${cssVar.colorText};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  createItemIcon: css`
    flex: none;
    color: ${cssVar.colorTextSecondary};
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

// The main/source worktree can never be removed (`git worktree remove <main>`
// fails with "is a main working tree"), and when the agent runs on a linked
// worktree it is listed with `current: false` — so exclude it by path too, not
// just via the `current` flag, to avoid offering a delete that always errors.
const canRemoveWorktree = (worktree: DeviceGitWorktreeListItem, sourcePath: string): boolean =>
  !worktree.current &&
  !worktree.locked &&
  !isDisabled(worktree) &&
  normalizeDisplayPath(worktree.path) !== normalizeDisplayPath(sourcePath);

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
    const [search, setSearch] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);
    // Paths currently being removed in the background. `git worktree remove` is
    // slow (up to a 30s timeout + device round-trip), so removal runs detached
    // from the confirm dialog — this tracks in-flight rows to guard against a
    // duplicate delete if the dropdown is reopened mid-removal.
    const [removingPaths, setRemovingPaths] = useState<Set<string>>(new Set());
    const currentRowRef = useRef<HTMLDivElement>(null);
    const { commit } = useCommitWorkingDirectory(agentId);

    // Clear the query each time the dropdown closes so it reopens unfiltered.
    useEffect(() => {
      if (!open) setSearch('');
    }, [open]);

    const handleRefresh = useCallback(async () => {
      if (isRefreshing) return;
      setIsRefreshing(true);
      try {
        await onWorktreesChange?.();
      } finally {
        setIsRefreshing(false);
      }
    }, [isRefreshing, onWorktreesChange]);

    // Filter by worktree folder name, path, or branch.
    const filtered = useMemo(() => {
      const query = search.trim().toLowerCase();
      if (!query) return worktrees;
      return worktrees.filter((worktree) => {
        const branch = getWorktreeBranch(worktree, currentBranch, () => '');
        return (
          getPathName(worktree.path).toLowerCase().includes(query) ||
          worktree.path.toLowerCase().includes(query) ||
          branch.toLowerCase().includes(query)
        );
      });
    }, [worktrees, search, currentBranch]);

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
          // Return synchronously (no promise) so the dialog closes instantly
          // instead of holding the user on a spinning modal for the duration of
          // a slow `git worktree remove`. The removal runs in the background;
          // completion and failure surface via bottom-left toasts, and the row
          // reconciles on the next `onWorktreesChange` revalidate.
          onOk: () => {
            setRemovingPaths((prev) => new Set(prev).add(worktree.path));
            void (async () => {
              const result = await gitService.removeGitWorktree({
                deviceId,
                path,
                worktreePath: worktree.path,
              });
              if (result.success) {
                // The list is hidden behind the closed dropdown, so this toast
                // is the only signal that the background removal finished.
                toast.success(t('workingDirectory.removeWorktreeSuccess'));
                await onWorktreesChange?.();
              } else {
                toast.error(result.error || t('workingDirectory.removeWorktreeFailed'));
              }
              setRemovingPaths((prev) => {
                const next = new Set(prev);
                next.delete(worktree.path);
                return next;
              });
            })();
          },
          title: t('workingDirectory.removeWorktreeTitle'),
        });
      },
      [deviceId, onWorktreesChange, path, t, tCommon],
    );

    // Create a worktree on a fresh branch (mirrors the branch switcher's "create
    // branch" flow), then switch the working directory into it. Returns an error
    // message for inline display in the modal, or undefined on success.
    const handleCreateWorktree = useCallback(
      async (branch: string): Promise<string | undefined> => {
        const worktreePath = deriveWorktreePath(sourcePath, branch);
        const result = await gitService.addGitWorktree({ branch, deviceId, path, worktreePath });
        if (!result.success) return result.error || t('workingDirectory.createWorktreeFailed');

        // Point the conversation at the freshly created worktree, then reconcile
        // the list so the new row (now `current`) appears.
        const createdPath = result.worktreePath ?? worktreePath;
        await commit({
          git: { activeWorktree: createdPath },
          path: sourcePath,
          repoType: isGithub ? 'github' : 'git',
        });
        await onWorktreesChange?.();
        return undefined;
      },
      [commit, deviceId, isGithub, onWorktreesChange, path, sourcePath, t],
    );

    const openCreateWorktree = useCallback(() => {
      setOpen(false);
      openCreateWorktreeModal({
        onSubmit: handleCreateWorktree,
        resolvePath: (branch) => deriveWorktreePath(sourcePath, branch),
      });
    }, [handleCreateWorktree, sourcePath]);

    // Scroll the current worktree into view each time the dropdown opens — the
    // list mounts at scrollTop=0, so a current worktree below the fold would
    // otherwise read as "nothing selected".
    useEffect(() => {
      if (!open) return;
      const raf = requestAnimationFrame(() => {
        currentRowRef.current?.scrollIntoView({ block: 'nearest' });
      });
      return () => cancelAnimationFrame(raf);
    }, [open, filtered.length, currentPath]);

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
                <div className={styles.searchBar}>
                  <Input
                    autoFocus
                    placeholder={t('workingDirectory.worktreeSearchPlaceholder')}
                    prefix={<Icon icon={SearchIcon} size={14} />}
                    size="small"
                    value={search}
                    variant="borderless"
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>

                <div className={styles.list}>
                  <div className={styles.sectionRow}>
                    <div className={styles.section}>{t('workingDirectory.worktreesHeading')}</div>
                    <div className={styles.refreshButton} role="button" onClick={handleRefresh}>
                      <Icon
                        className={cx(isRefreshing && styles.spinning)}
                        icon={RefreshCwIcon}
                        size={12}
                      />
                    </div>
                  </div>

                  {filtered.length === 0 ? (
                    <div className={styles.emptyState}>
                      {search.trim()
                        ? t('workingDirectory.worktreesNoMatch')
                        : t('workingDirectory.worktreesEmpty')}
                    </div>
                  ) : (
                    filtered.map((worktree) => {
                      const branch = getWorktreeBranch(worktree, currentBranch, (sha) =>
                        t('workingDirectory.detachedHeadShort', { sha }),
                      );
                      const displayPath = getRelativeDisplayPath(worktree.path, sourcePath);
                      const disabled = isDisabled(worktree);
                      const removing = removingPaths.has(worktree.path);
                      const removable = canRemoveWorktree(worktree, sourcePath) && !removing;

                      return (
                        <DropdownMenuItem
                          aria-disabled={disabled}
                          className={styles.item}
                          closeOnClick={false}
                          data-current={worktree.current}
                          key={worktree.path}
                          ref={worktree.path === currentPath ? currentRowRef : undefined}
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
                            {removing ? (
                              <Icon spin icon={LoaderCircleIcon} size={13} />
                            ) : worktree.current ? (
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

                <div className={styles.createItemWrapper}>
                  <DropdownMenuItem
                    className={styles.createItem}
                    closeOnClick={false}
                    onClick={openCreateWorktree}
                  >
                    <Icon className={styles.createItemIcon} icon={FolderPlusIcon} size={14} />
                    <div>{t('workingDirectory.createWorktreeAction')}</div>
                  </DropdownMenuItem>
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
