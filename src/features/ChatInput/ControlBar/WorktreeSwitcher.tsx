import { deriveWorktreePath, type DeviceGitWorktreeListItem } from '@lobechat/types';
import {
  confirmModal,
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  Icon,
  Input,
  Spin,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CheckIcon,
  FolderPlusIcon,
  GitBranchIcon,
  GitForkIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  memo,
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { gitService } from '@/services/git';

import { openCreateWorktreeModal } from './CreateWorktreeModal';
import gitMenuTriggerStyles from './gitMenuTrigger.module.css';
import { useSwitchWorktree } from './useSwitchWorktree';
import { getPathName, isDisabled, normalizeDisplayPath } from './worktreeHelpers';

const spin = stylex.keyframes({ to: { transform: 'rotate(360deg)' } });

const styles = stylex.create({
  actionCell: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
  },
  badge: {
    flex: 'none',
    paddingBlock: '1px',
    paddingInline: '5px',
    borderRadius: '999px',
    fontSize: '11px',
    lineHeight: '15px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  branch: {
    overflow: 'hidden',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    minWidth: '40px',
    maxWidth: '300px',
    fontSize: '13px',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  check: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    color: cssVar.colorPrimary,
  },
  container: {
    display: 'flex',
    flexDirection: 'column',
    width: '460px',
    maxWidth: 'calc(100vw - 48px)',
    height: '380px',
    // Cancel DropdownMenuPopup's default 4px padding so our sections align edge-to-edge
    margin: '-4px',
  },
  createItem: {
    cursor: 'pointer',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderRadius: '8px',
    fontSize: '13px',
    color: cssVar.colorText,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  createItemIcon: { flex: 'none', color: cssVar.colorTextSecondary },
  createItemWrapper: {
    padding: '6px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorSplit,
  },
  diffStat: {
    display: 'inline-flex',
    flex: 'none',
    gap: '3px',
    justifyContent: 'flex-end',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
  },
  diffStatAdded: { color: cssVar.colorSuccess },
  diffStatDeleted: { color: cssVar.colorError },
  diffStatModified: { color: cssVar.colorWarning },
  dirtyCell: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minWidth: '44px',
  },
  emptyState: {
    paddingBlock: '16px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  item: {
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(44px, auto) 20px',
    gap: '10px',
    alignItems: 'center',
    minHeight: '48px',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderRadius: '8px',
    fontSize: '13px',
    color: cssVar.colorText,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  // [data-current='true'] — declared after the hover rule, so it wins on hover too.
  itemCurrent: { backgroundColor: cssVar.colorFillSecondary, backgroundImage: 'none' },
  // [aria-disabled='true']
  itemDisabled: { cursor: 'not-allowed', opacity: 0.55 },
  itemMain: { overflow: 'hidden', minWidth: '0' },
  list: { overflowY: 'auto', flex: '1', padding: '6px' },
  name: {
    overflow: 'hidden',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    maxWidth: '240px',
    fontSize: '13px',
    fontWeight: 400,
    lineHeight: '18px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  path: {
    overflow: 'hidden',
    marginBlockStart: '1px',
    fontSize: '11px',
    lineHeight: '16px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  refreshButton: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '4px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    transition: 'all 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  // Revealed while the row (the `defaultMarker` on `item`) is hovered.
  rowAction: {
    cursor: 'pointer',
    display: {
      default: 'none',
      [stylex.when.ancestor(':hover')]: 'flex',
    },
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '4px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorError },
    transition: 'all 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorErrorBg },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  rowTitle: {
    overflow: 'hidden',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    whiteSpace: 'nowrap',
  },
  searchBar: {
    paddingBlock: '4px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorSplit,
  },
  section: { flex: '1', fontSize: '11px', fontWeight: 500, color: cssVar.colorTextTertiary },
  sectionRow: {
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    paddingBlockStart: '4px',
    paddingBlockEnd: '2px',
    paddingInline: '8px',
  },
  spinning: {
    animationName: spin,
    animationDuration: '0.8s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  trigger: {
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '22px',
    borderRadius: '4px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
    transition: 'background 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

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

// The main worktree can never be removed (`git worktree remove <main>` fails with
// "is a main working tree"), and when the agent runs on a linked worktree it is
// listed with `current: false` — so exclude it by path too, not just via the
// `current` flag, to avoid offering a delete that always errors. `sourcePath` is
// NOT the main worktree whenever the user picks a linked worktree directly as the
// working directory, so it is excluded separately (removing the conversation's own
// source repo would strand it), not used as a stand-in for the main worktree.
const canRemoveWorktree = (
  worktree: DeviceGitWorktreeListItem,
  sourcePath: string,
  mainWorktreePath?: string,
): boolean =>
  !worktree.current &&
  !worktree.locked &&
  !isDisabled(worktree) &&
  normalizeDisplayPath(worktree.path) !== normalizeDisplayPath(sourcePath) &&
  (!mainWorktreePath ||
    normalizeDisplayPath(worktree.path) !== normalizeDisplayPath(mainWorktreePath));

interface DirtyStatProps {
  status?: DeviceGitWorktreeListItem['status'];
}

const DirtyStat = memo<DirtyStatProps>(({ status }) => {
  if (!status || status.clean) return null;

  return (
    <span {...stylex.props(styles.diffStat)}>
      {status.added > 0 && <span {...stylex.props(styles.diffStatAdded)}>+{status.added}</span>}
      {status.modified > 0 && (
        <span {...stylex.props(styles.diffStatModified)}>±{status.modified}</span>
      )}
      {status.deleted > 0 && (
        <span {...stylex.props(styles.diffStatDeleted)}>-{status.deleted}</span>
      )}
    </span>
  );
});

DirtyStat.displayName = 'DirtyStat';

interface WorktreeSwitcherProps {
  agentId: string;
  /** Custom trigger element; the default is the compact branch/fork icon chip. */
  children?: ReactElement;
  currentBranch: string;
  detached?: boolean;
  deviceId?: string;
  /** Mounted but inert while a stale-first branch awaits confirmation. */
  disabled?: boolean;
  isGithub: boolean;
  onWorktreesChange?: () => Promise<unknown> | unknown;
  path: string;
  /** Dropdown placement — the runtime bar opens upward, embedding panels open downward. */
  placement?: 'topLeft' | 'bottomLeft' | 'bottomRight';
  sourcePath: string;
  /** The conversation the switch is recorded on; omitted, the global active topic. */
  topicId?: string | null;
  worktrees: DeviceGitWorktreeListItem[];
}

const WorktreeSwitcher = memo<WorktreeSwitcherProps>(
  ({
    agentId,
    children,
    currentBranch,
    detached,
    deviceId,
    disabled = false,
    isGithub,
    onWorktreesChange,
    path,
    placement = 'topLeft',
    sourcePath,
    topicId,
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
    const [removingPaths, setRemovingPaths] = useState<Set<string>>(() => new Set());
    const currentRowRef = useRef<HTMLDivElement>(null);
    const switchWorktree = useSwitchWorktree({ agentId, isGithub, sourcePath, topicId });

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

        await switchWorktree(worktree.path, worktree.detached ? undefined : worktree.branch);
        setOpen(false);
      },
      [switchWorktree],
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
            // The dropdown is already closed, so a persistent loading toast is the
            // only signal that a (potentially slow) removal is in progress. It gets
            // swapped for the success/failure toast once the background op settles.
            const pendingToast = toast.loading(
              t('workingDirectory.removeWorktreePending', {
                name: getPathName(worktree.path),
              }),
            );
            void (async () => {
              const result = await gitService.removeGitWorktree({
                deviceId,
                path,
                worktreePath: worktree.path,
              });
              pendingToast.close();
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
        await switchWorktree(result.worktreePath ?? worktreePath, branch);
        await onWorktreesChange?.();
        return undefined;
      },
      [deviceId, onWorktreesChange, path, sourcePath, switchWorktree, t],
    );

    const openCreateWorktree = useCallback(() => {
      setOpen(false);
      openCreateWorktreeModal({
        // The modal reads the repo's full local branch list itself and draws the
        // generated default from it, so a name is not handed out twice and does
        // not collide with a ref on the `wt` namespace path (see
        // `generateWorktreeBranchName`). It lives there rather than here so the
        // list can be awaited: snapshotting an in-flight (empty) list would hand
        // out a name git is guaranteed to refuse.
        deviceId,
        onSubmit: handleCreateWorktree,
        path,
        resolvePath: (branch) => deriveWorktreePath(sourcePath, branch),
      });
    }, [deviceId, handleCreateWorktree, path, sourcePath]);

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
    // `git worktree list` always emits the main worktree first (a bare repo has
    // none, so every checkout is linked). Compare against it rather than
    // `sourcePath`, which is itself a linked worktree whenever the user picks one
    // directly as the working directory — that would show a branch icon while
    // standing inside a worktree.
    const [mainWorktree] = worktrees;
    const isLinkedWorktree =
      !!mainWorktree &&
      (!!mainWorktree.bare ||
        normalizeDisplayPath(currentPath) !== normalizeDisplayPath(mainWorktree.path));
    const triggerIcon = isLinkedWorktree ? GitForkIcon : GitBranchIcon;

    const trigger = children ?? (
      <div
        aria-label={t('workingDirectory.worktreesHeading')}
        {...stylex.props(styles.trigger)}
        role="button"
      >
        <Icon icon={triggerIcon} size={13} />
      </div>
    );

    return (
      <DropdownMenuRoot
        open={!disabled && open}
        onOpenChange={(next) => {
          if (!disabled) setOpen(next);
        }}
      >
        <DropdownMenuTrigger>
          <div
            aria-disabled={disabled}
            className={gitMenuTriggerStyles.trigger}
            data-disabled={disabled || undefined}
          >
            {open ? trigger : <Tooltip title={triggerTitle}>{trigger}</Tooltip>}
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner placement={placement} sideOffset={8}>
            <DropdownMenuPopup>
              <div {...stylex.props(styles.container)}>
                <div {...stylex.props(styles.searchBar)}>
                  <Input
                    autoFocus
                    placeholder={t('workingDirectory.worktreeSearchPlaceholder')}
                    prefix={<Icon icon={SearchIcon} size={14} />}
                    size="small"
                    style={{ paddingInline: 0 }}
                    value={search}
                    variant="borderless"
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>

                <div {...stylex.props(styles.list)}>
                  <div {...stylex.props(styles.sectionRow)}>
                    <div {...stylex.props(styles.section)}>
                      {t('workingDirectory.worktreesHeading')}
                    </div>
                    <div
                      {...stylex.props(styles.refreshButton)}
                      role="button"
                      onClick={handleRefresh}
                    >
                      <Icon
                        icon={RefreshCwIcon}
                        size={12}
                        className={
                          isRefreshing ? stylex.props(styles.spinning).className : undefined
                        }
                      />
                    </div>
                  </div>

                  {filtered.length === 0 ? (
                    <div {...stylex.props(styles.emptyState)}>
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
                      const removable =
                        canRemoveWorktree(worktree, sourcePath, mainWorktree?.path) && !removing;

                      return (
                        <DropdownMenuItem
                          aria-disabled={disabled}
                          closeOnClick={false}
                          data-current={worktree.current}
                          key={worktree.path}
                          ref={worktree.path === currentPath ? currentRowRef : undefined}
                          className={
                            stylex.props(
                              stylex.defaultMarker(),
                              styles.item,
                              worktree.current && styles.itemCurrent,
                              disabled && styles.itemDisabled,
                            ).className
                          }
                          onClick={() => void commitWorktree(worktree)}
                        >
                          <div {...stylex.props(styles.itemMain)}>
                            <div {...stylex.props(styles.rowTitle)}>
                              <span {...stylex.props(styles.name)}>
                                {getPathName(worktree.path)}
                              </span>
                              <span {...stylex.props(styles.branch)}>{branch}</span>
                              {worktree.current && (
                                <span {...stylex.props(styles.badge)}>
                                  {t('workingDirectory.currentWorktree')}
                                </span>
                              )}
                              {worktree.detached && (
                                <span {...stylex.props(styles.badge)}>
                                  {t('workingDirectory.detachedWorktree')}
                                </span>
                              )}
                              {worktree.locked && (
                                <span {...stylex.props(styles.badge)}>
                                  {t('workingDirectory.lockedWorktree')}
                                </span>
                              )}
                              {worktree.prunable && (
                                <span {...stylex.props(styles.badge)}>
                                  {t('workingDirectory.prunableWorktree')}
                                </span>
                              )}
                              {worktree.bare && (
                                <span {...stylex.props(styles.badge)}>
                                  {t('workingDirectory.bareWorktree')}
                                </span>
                              )}
                            </div>
                            <div {...stylex.props(styles.path)} title={worktree.path}>
                              {displayPath}
                            </div>
                          </div>
                          <div {...stylex.props(styles.dirtyCell)}>
                            <DirtyStat status={worktree.status} />
                          </div>
                          <div {...stylex.props(styles.actionCell)}>
                            {removing ? (
                              <Spin size={13} />
                            ) : worktree.current ? (
                              <Icon
                                className={stylex.props(styles.check).className}
                                icon={CheckIcon}
                                size={14}
                              />
                            ) : (
                              removable && (
                                <Tooltip title={t('workingDirectory.removeWorktreeAction')}>
                                  <div
                                    aria-label={t('workingDirectory.removeWorktreeAction')}
                                    {...stylex.props(styles.rowAction)}
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

                <div {...stylex.props(styles.createItemWrapper)}>
                  <DropdownMenuItem
                    className={stylex.props(styles.createItem).className}
                    closeOnClick={false}
                    onClick={openCreateWorktree}
                  >
                    <Icon
                      className={stylex.props(styles.createItemIcon).className}
                      icon={FolderPlusIcon}
                      size={14}
                    />
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
