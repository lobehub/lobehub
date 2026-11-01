import type { DeviceGitWorktreeListItem } from '@lobechat/types';
import {
  confirmModal,
  copyToClipboard,
  DropdownMenuFooter,
  DropdownMenuHeader,
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuScrollViewport,
  DropdownMenuTrigger,
  Icon,
  Input,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CheckIcon,
  CopyIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  GitForkIcon,
  LoaderIcon,
  PencilIcon,
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
import { useFetchGitWorkingTreeStatus } from '@/store/device';

import { openCreateBranchModal } from './CreateBranchModal';
import gitMenuTriggerStyles from './gitMenuTrigger.module.css';
import { openRenameBranchModal } from './RenameBranchModal';
import { useBranchList } from './useBranchList';
import { useSwitchWorktree } from './useSwitchWorktree';
import { findWorktreeForBranch, getPathName } from './worktreeHelpers';

const spin = stylex.keyframes({ to: { transform: 'rotate(360deg)' } });

const styles = stylex.create({
  branchLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // Fill the list slot like `list` does, so the footer stays pinned to the
  // bottom of the fixed-height popup while loading / empty.
  emptyState: {
    display: 'flex',
    flex: '1',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '0',
    paddingBlock: '12px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  footer: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorSplit,
  },
  header: { padding: '0' },
  item: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    height: 'auto',
    minHeight: '32px',
    paddingBlock: '4px',
    paddingInline: '8px',
    borderRadius: '4px',
    fontSize: '14px',
    lineHeight: '20px',
    color: cssVar.colorText,
  },
  // Swap the checkmark for the row actions while hovering the row (the
  // `defaultMarker` on `item`).
  itemCheck: {
    display: { default: null, [stylex.when.ancestor(':hover')]: 'none' },
    flex: 'none',
    color: cssVar.colorPrimary,
  },
  itemIcon: { flex: 'none', color: cssVar.colorTextSecondary },
  itemMain: { overflow: 'hidden', flex: '1', minWidth: '0' },
  itemMeta: { fontSize: '12px', lineHeight: '16px', color: cssVar.colorTextTertiary },
  list: { flex: '1', minHeight: '0' },
  // The base popup only becomes a flex column once the virtual list mounts;
  // force it so the loading / empty placeholder can fill the list slot too.
  popup: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    width: '300px',
    height: '360px',
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
  rowAction: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '4px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    transition: 'all 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  rowActionDanger: {
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorError },
    backgroundColor: { 'default': null, ':hover': cssVar.colorErrorBg },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  rowActions: {
    display: { default: 'none', [stylex.when.ancestor(':hover')]: 'flex' },
    flex: 'none',
    gap: '2px',
    alignItems: 'center',
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
});

interface BranchSwitcherProps {
  agentId: string;
  children: ReactElement;
  currentBranch?: string;
  /**
   * When set, branch list + checkout go through the `device.*` RPCs (web / remote
   * device). Omit for the local machine, which talks to Electron over IPC.
   */
  deviceId?: string;
  isGithub: boolean;
  onAfterCheckout?: () => void;
  onExternalRefresh?: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  /** Reflect a branch switch in the UI immediately, before the checkout lands. */
  onOptimisticCheckout?: (branch: string) => void;
  open: boolean;
  path: string;
  /** Dropdown placement — the runtime bar opens upward, embedding panels open downward. */
  placement?: 'topLeft' | 'bottomLeft' | 'bottomRight';
  /** The repo the conversation is anchored to (worktrees hang off it). */
  sourcePath: string;
  /** The conversation the switch is recorded on; omitted, the global active topic. */
  topicId?: string | null;
  /** Used to route a checkout into the worktree that already holds the branch. */
  worktrees: DeviceGitWorktreeListItem[];
}

const BranchSwitcher = memo<BranchSwitcherProps>(
  ({
    agentId,
    path,
    currentBranch,
    deviceId,
    isGithub,
    open,
    onOpenChange,
    onAfterCheckout,
    onExternalRefresh,
    onOptimisticCheckout,
    placement = 'topLeft',
    sourcePath,
    topicId,
    worktrees,
    children,
  }) => {
    const { t } = useTranslation('device');
    const { t: tCommon } = useTranslation('common');
    const [search, setSearch] = useState('');
    const [busyBranch, setBusyBranch] = useState<string | null>(null);
    const currentRowRef = useRef<HTMLDivElement>(null);
    const switchWorktree = useSwitchWorktree({ agentId, isGithub, sourcePath, topicId });

    // The persisted list paints the moment the dropdown opens; the read refreshes it.
    const {
      branches,
      error: branchesError,
      isLoading,
      loadFailed,
      refreshBranches,
      revalidate: mutateBranches,
    } = useBranchList(deviceId, path, open);
    const { data: workingStatus, mutate: mutateWorkingStatus } = useFetchGitWorkingTreeStatus(
      deviceId,
      path,
    );
    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefresh = useCallback(async () => {
      if (isRefreshing) return;
      setIsRefreshing(true);
      try {
        await Promise.all([
          mutateBranches(),
          mutateWorkingStatus(),
          Promise.resolve(onExternalRefresh?.()),
        ]);
      } finally {
        setIsRefreshing(false);
      }
    }, [isRefreshing, mutateBranches, mutateWorkingStatus, onExternalRefresh]);

    useEffect(() => {
      if (!open) setSearch('');
    }, [open]);

    // Surface a branch-list load failure as a Toast with Retry (base-ui Toast
    // carries an action; antd `message` can't). Reopening the dropdown also
    // refetches, but Retry recovers without closing.
    useEffect(() => {
      if (open && branchesError) {
        toast.error({
          actions: [
            { label: tCommon('retry'), onClick: () => void mutateBranches(), variant: 'text' },
          ],
          title: t('workingDirectory.branchesLoadFailed'),
        });
      }
    }, [open, branchesError, mutateBranches, t, tCommon]);

    // Scroll the current branch into view each time the dropdown opens — the
    // popup mounts at scrollTop=0, so a checked branch below the fold would read
    // as "nothing selected". Keyed on branches.length so it fires once the async
    // list has painted.
    useEffect(() => {
      if (!open) return;
      const raf = requestAnimationFrame(() => {
        currentRowRef.current?.scrollIntoView({ block: 'nearest' });
      });
      return () => cancelAnimationFrame(raf);
    }, [open, branches.length, currentBranch]);

    const filtered = useMemo(() => {
      const query = search.trim().toLowerCase();
      if (!query) return branches;
      return branches.filter((b) => b.name.toLowerCase().includes(query));
    }, [branches, search]);

    const handleCheckout = useCallback(
      async (branch: string, create = false) => {
        if (busyBranch) return;
        if (!create && branch === currentBranch) {
          onOpenChange(false);
          return;
        }

        // Git refuses to check out a branch another worktree already holds. That
        // worktree's HEAD is on the branch, so switching into it is what the user
        // asked for — route there instead of surfacing git's error.
        const owner = create ? undefined : findWorktreeForBranch(worktrees, branch);
        if (owner) {
          setBusyBranch(branch);
          onOpenChange(false);
          try {
            await switchWorktree(owner.path, branch);
          } finally {
            onAfterCheckout?.();
            setBusyBranch(null);
          }
          return;
        }

        setBusyBranch(branch);
        // Reflect the switch instantly and close; the checkout + revalidate
        // reconcile in the background (a failure rolls the label back).
        onOptimisticCheckout?.(branch);
        onOpenChange(false);
        try {
          const result = await gitService.checkoutGitBranch({ branch, create, deviceId, path });
          if (!result.success) {
            toast.error(result.error || t('workingDirectory.checkoutFailed'));
          }
        } finally {
          onAfterCheckout?.();
          setBusyBranch(null);
        }
      },
      [
        busyBranch,
        currentBranch,
        deviceId,
        onAfterCheckout,
        onOptimisticCheckout,
        onOpenChange,
        path,
        switchWorktree,
        t,
        worktrees,
      ],
    );

    // Create + checkout a new branch from the modal. Returns an error message
    // for inline display (keeps the modal open), or undefined on success.
    const handleCreateBranch = useCallback(
      async (name: string): Promise<string | undefined> => {
        onOptimisticCheckout?.(name);
        const result = await gitService.checkoutGitBranch({
          branch: name,
          create: true,
          deviceId,
          path,
        });
        // Reconcile either way: success fills in PR / ahead-behind, failure rolls
        // the optimistic label back to the real branch.
        onAfterCheckout?.();
        if (result.success) {
          void refreshBranches();
          onOpenChange(false);
          return undefined;
        }
        return result.error || t('workingDirectory.checkoutFailed');
      },
      [deviceId, onAfterCheckout, onOptimisticCheckout, onOpenChange, path, refreshBranches, t],
    );

    const openCreateBranch = useCallback(() => {
      onOpenChange(false);
      openCreateBranchModal({ onSubmit: handleCreateBranch });
    }, [handleCreateBranch, onOpenChange]);

    // Rename a branch from a modal. Closes the dropdown first (mirrors create),
    // then reconciles via onAfterCheckout — a renamed current branch updates the
    // header label — and re-reads the list, so its next open paints the new name.
    const handleRename = useCallback(
      (event: MouseEvent, branch: string) => {
        event.stopPropagation();
        onOpenChange(false);
        openRenameBranchModal({
          currentName: branch,
          onSubmit: async (newName) => {
            if (newName === branch) return undefined;
            const result = await gitService.renameGitBranch({
              deviceId,
              from: branch,
              path,
              to: newName,
            });
            onAfterCheckout?.();
            if (result.success) {
              void refreshBranches();
              return undefined;
            }
            return result.error || t('workingDirectory.renameFailed');
          },
        });
      },
      [deviceId, onAfterCheckout, onOpenChange, path, refreshBranches, t],
    );

    const handleCopy = useCallback(
      async (event: MouseEvent, branch: string) => {
        event.stopPropagation();
        try {
          await copyToClipboard(branch);
          toast.success(tCommon('copySuccess'));
        } catch {
          toast.error(tCommon('copyFail'));
        }
      },
      [tCommon],
    );

    // Delete a branch behind a destructive confirm. git rejects deleting the
    // checked-out branch, so the action is hidden for the current branch.
    const handleDelete = useCallback(
      (event: MouseEvent, branch: string) => {
        event.stopPropagation();
        onOpenChange(false);
        confirmModal({
          cancelText: tCommon('cancel'),
          content: t('workingDirectory.deleteBranchConfirm', { name: branch }),
          okButtonProps: { danger: true },
          okText: tCommon('delete'),
          onOk: async () => {
            const result = await gitService.deleteGitBranch({ branch, deviceId, path });
            onAfterCheckout?.();
            if (result.success) void refreshBranches();
            else toast.error(result.error || t('workingDirectory.deleteFailed'));
          },
          title: t('workingDirectory.deleteBranchTitle'),
        });
      },
      [deviceId, onAfterCheckout, onOpenChange, path, refreshBranches, t, tCommon],
    );

    return (
      <DropdownMenuRoot open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger>
          <div className={gitMenuTriggerStyles.trigger}>{children}</div>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner placement={placement} sideOffset={8}>
            <DropdownMenuPopup className={stylex.props(styles.popup).className}>
              <DropdownMenuHeader className={stylex.props(styles.header).className}>
                <div {...stylex.props(styles.searchBar)}>
                  <Input
                    autoFocus
                    placeholder={t('workingDirectory.branchSearchPlaceholder')}
                    prefix={<Icon icon={SearchIcon} size={14} />}
                    size="small"
                    style={{ paddingInline: 0 }}
                    value={search}
                    variant="borderless"
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                <div {...stylex.props(styles.sectionRow)}>
                  <div {...stylex.props(styles.section)}>
                    {t('workingDirectory.branchesHeading')}
                  </div>
                  <div
                    {...stylex.props(styles.refreshButton)}
                    role="button"
                    onClick={handleRefresh}
                  >
                    <Icon
                      className={isRefreshing ? stylex.props(styles.spinning).className : undefined}
                      icon={RefreshCwIcon}
                      size={12}
                    />
                  </div>
                </div>
              </DropdownMenuHeader>

              {isLoading && branches.length === 0 ? (
                <div {...stylex.props(styles.emptyState)}>
                  {t('workingDirectory.branchesLoading')}
                </div>
              ) : loadFailed ? (
                // A failed refresh keeps the list it already has on screen.
                <div {...stylex.props(styles.emptyState)}>
                  {t('workingDirectory.branchesLoadFailed')}
                </div>
              ) : filtered.length === 0 ? (
                <div {...stylex.props(styles.emptyState)}>
                  {search.trim()
                    ? t('workingDirectory.branchesNoMatch')
                    : t('workingDirectory.branchesEmpty')}
                </div>
              ) : (
                <DropdownMenuScrollViewport
                  virtual
                  className={stylex.props(styles.list).className}
                  getItemLabel={(_, index) => filtered[index]?.name}
                  // The virtual viewport sizes itself on mount: a background
                  // refresh that adds branches while the dropdown is open
                  // would otherwise leave the extra rows (often the current
                  // branch, last) undrawn. Remount when the count changes.
                  key={filtered.length}
                  listItemHeight={32}
                >
                  {filtered.map((branch) => {
                    const isCurrent = branch.name === currentBranch;
                    const isBusy = busyBranch === branch.name;
                    // A branch another worktree holds can't be checked out here
                    // (clicking routes into that worktree) and can't be deleted.
                    const owner = findWorktreeForBranch(worktrees, branch.name);
                    return (
                      <DropdownMenuItem
                        className={stylex.props(stylex.defaultMarker(), styles.item).className}
                        closeOnClick={false}
                        key={branch.name}
                        ref={isCurrent ? currentRowRef : undefined}
                        onClick={() => handleCheckout(branch.name)}
                      >
                        <Icon
                          icon={isBusy ? LoaderIcon : owner ? GitForkIcon : GitBranchIcon}
                          size={14}
                          className={
                            stylex.props(styles.itemIcon, isBusy && styles.spinning).className
                          }
                        />
                        <div {...stylex.props(styles.itemMain)}>
                          <div {...stylex.props(styles.branchLabel)}>{branch.name}</div>
                          {isCurrent && workingStatus && !workingStatus.clean && (
                            <div {...stylex.props(styles.itemMeta)}>
                              {t('workingDirectory.uncommittedChanges', {
                                count: workingStatus.total,
                              })}
                            </div>
                          )}
                          {owner && (
                            <div {...stylex.props(styles.itemMeta)}>
                              {t('workingDirectory.branchInWorktree', {
                                name: getPathName(owner.path),
                              })}
                            </div>
                          )}
                        </div>
                        {isCurrent && (
                          <Icon
                            className={stylex.props(styles.itemCheck).className}
                            icon={CheckIcon}
                            size={14}
                          />
                        )}
                        <div {...stylex.props(styles.rowActions)}>
                          <Tooltip title={tCommon('copy')}>
                            <div
                              aria-label={tCommon('copy')}
                              {...stylex.props(styles.rowAction)}
                              role="button"
                              onClick={(e) => void handleCopy(e, branch.name)}
                            >
                              <Icon icon={CopyIcon} size={13} />
                            </div>
                          </Tooltip>
                          <Tooltip title={t('workingDirectory.renameBranchAction')}>
                            <div
                              {...stylex.props(styles.rowAction)}
                              role="button"
                              onClick={(e) => handleRename(e, branch.name)}
                            >
                              <Icon icon={PencilIcon} size={13} />
                            </div>
                          </Tooltip>
                          {!isCurrent && !owner && (
                            <Tooltip title={t('workingDirectory.deleteBranchAction')}>
                              <div
                                {...stylex.props(styles.rowAction, styles.rowActionDanger)}
                                role="button"
                                onClick={(e) => handleDelete(e, branch.name)}
                              >
                                <Icon icon={Trash2Icon} size={13} />
                              </div>
                            </Tooltip>
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuScrollViewport>
              )}

              <DropdownMenuFooter className={stylex.props(styles.footer).className}>
                <DropdownMenuItem
                  className={stylex.props(styles.item).className}
                  onClick={openCreateBranch}
                >
                  <Icon
                    className={stylex.props(styles.itemIcon).className}
                    icon={GitBranchPlusIcon}
                    size={14}
                  />
                  <div {...stylex.props(styles.itemMain)}>
                    {t('workingDirectory.createBranchAction')}
                  </div>
                </DropdownMenuItem>
              </DropdownMenuFooter>
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    );
  },
);

BranchSwitcher.displayName = 'BranchSwitcher';

export default BranchSwitcher;
