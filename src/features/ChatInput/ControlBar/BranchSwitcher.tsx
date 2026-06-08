import { Icon, Input } from '@lobehub/ui';
import {
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  CheckIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  LoaderIcon,
  RefreshCwIcon,
  SearchIcon,
} from 'lucide-react';
import { memo, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { message } from '@/components/AntdStaticMethods';
import { gitService } from '@/services/git';
import { useFetchGitWorkingTreeStatus } from '@/store/device';

import { openCreateBranchModal } from './CreateBranchModal';

const styles = createStaticStyles(({ css }) => ({
  branchLabel: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  container: css`
    display: flex;
    flex-direction: column;

    width: 300px;
    height: 360px;

    /* Cancel DropdownMenuPopup's default 4px padding so our sections align edge-to-edge */
    margin: -4px;
  `,
  createItemWrapper: css`
    padding: 4px;
    border-block-start: 1px solid ${cssVar.colorSplit};
  `,
  createItem: css`
    border-radius: calc(${cssVar.borderRadius} - 4px);
  `,
  emptyState: css`
    padding-block: 12px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  item: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 4px;

    font-size: 13px;
    line-height: 1.3;
    color: ${cssVar.colorText};
  `,
  itemCheck: css`
    flex: none;
    color: ${cssVar.colorPrimary};
  `,
  itemIcon: css`
    flex: none;
    color: ${cssVar.colorTextSecondary};
  `,
  itemMain: css`
    overflow: hidden;
    flex: 1;
    min-width: 0;
  `,
  itemMeta: css`
    margin-block-start: 1px;
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  list: css`
    overflow-y: auto;
    flex: 1;
    padding-block: 2px;
    padding-inline: 4px;
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
  spinning: css`
    animation: branch-switcher-spin 0.8s linear infinite;

    @keyframes branch-switcher-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
}));

interface BranchSwitcherProps {
  children: ReactElement;
  currentBranch?: string;
  /**
   * When set, branch list + checkout go through the `device.*` RPCs (web / remote
   * device). Omit for the local machine, which talks to Electron over IPC.
   */
  deviceId?: string;
  onAfterCheckout?: () => void;
  onExternalRefresh?: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  /** Reflect a branch switch in the UI immediately, before the checkout lands. */
  onOptimisticCheckout?: (branch: string) => void;
  open: boolean;
  path: string;
}

const BranchSwitcher = memo<BranchSwitcherProps>(
  ({
    path,
    currentBranch,
    deviceId,
    open,
    onOpenChange,
    onAfterCheckout,
    onExternalRefresh,
    onOptimisticCheckout,
    children,
  }) => {
    const { t } = useTranslation('device');
    const [search, setSearch] = useState('');
    const [busyBranch, setBusyBranch] = useState<string | null>(null);

    const {
      data: branches = [],
      isLoading,
      error: branchesError,
      mutate: mutateBranches,
    } = useSWR(
      open ? ['git-branches', deviceId ?? 'local', path] : null,
      () => gitService.listGitBranches({ deviceId, path }),
      { revalidateOnFocus: false, shouldRetryOnError: false },
    );
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
        setBusyBranch(branch);
        // Reflect the switch instantly and close; the checkout + revalidate
        // reconcile in the background (a failure rolls the label back).
        onOptimisticCheckout?.(branch);
        onOpenChange(false);
        try {
          const result = await gitService.checkoutGitBranch({ branch, create, deviceId, path });
          if (!result.success) {
            message.error(result.error || t('workingDirectory.checkoutFailed'));
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
        t,
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
          onOpenChange(false);
          return undefined;
        }
        return result.error || t('workingDirectory.checkoutFailed');
      },
      [deviceId, onAfterCheckout, onOptimisticCheckout, onOpenChange, path, t],
    );

    const openCreateBranch = useCallback(() => {
      onOpenChange(false);
      openCreateBranchModal({ onSubmit: handleCreateBranch });
    }, [handleCreateBranch, onOpenChange]);

    return (
      <DropdownMenuRoot open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger>{children}</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner placement="topLeft" sideOffset={8}>
            <DropdownMenuPopup>
              <div className={styles.container}>
                <div className={styles.searchBar}>
                  <Input
                    autoFocus
                    placeholder={t('workingDirectory.branchSearchPlaceholder')}
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
                    <div className={styles.section}>{t('workingDirectory.branchesHeading')}</div>
                    <div className={styles.refreshButton} role="button" onClick={handleRefresh}>
                      <Icon
                        className={cx(isRefreshing && styles.spinning)}
                        icon={RefreshCwIcon}
                        size={12}
                      />
                    </div>
                  </div>

                  {isLoading && branches.length === 0 && (
                    <div className={styles.emptyState}>{t('workingDirectory.branchesLoading')}</div>
                  )}

                  {!isLoading && branchesError && (
                    <div className={styles.emptyState}>
                      {(branchesError as Error)?.message || t('workingDirectory.branchesEmpty')}
                    </div>
                  )}

                  {!isLoading && !branchesError && filtered.length === 0 && (
                    <div className={styles.emptyState}>
                      {search.trim()
                        ? t('workingDirectory.branchesNoMatch')
                        : t('workingDirectory.branchesEmpty')}
                    </div>
                  )}

                  {filtered.map((branch) => {
                    const isCurrent = branch.name === currentBranch;
                    const isBusy = busyBranch === branch.name;
                    return (
                      <DropdownMenuItem
                        className={styles.item}
                        closeOnClick={false}
                        key={branch.name}
                        onClick={() => handleCheckout(branch.name)}
                      >
                        <Icon
                          className={cx(styles.itemIcon, isBusy && styles.spinning)}
                          icon={isBusy ? LoaderIcon : GitBranchIcon}
                          size={14}
                        />
                        <div className={styles.itemMain}>
                          <div className={styles.branchLabel}>{branch.name}</div>
                          {isCurrent && workingStatus && !workingStatus.clean && (
                            <div className={styles.itemMeta}>
                              {t('workingDirectory.uncommittedChanges', {
                                count: workingStatus.total,
                              })}
                            </div>
                          )}
                        </div>
                        {isCurrent && (
                          <Icon className={styles.itemCheck} icon={CheckIcon} size={14} />
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </div>

                <div className={styles.createItemWrapper}>
                  <DropdownMenuItem
                    className={cx(styles.item, styles.createItem)}
                    onClick={openCreateBranch}
                  >
                    <Icon className={styles.itemIcon} icon={GitBranchPlusIcon} size={14} />
                    <div className={styles.itemMain}>
                      {t('workingDirectory.createBranchAction')}
                    </div>
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

BranchSwitcher.displayName = 'BranchSwitcher';

export default BranchSwitcher;
