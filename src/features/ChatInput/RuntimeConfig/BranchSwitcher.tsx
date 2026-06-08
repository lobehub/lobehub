import { Button, Icon, Input } from '@lobehub/ui';
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
import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { message } from '@/components/AntdStaticMethods';
import { lambdaClient } from '@/libs/trpc/client';
import { electronGitService } from '@/services/electron/git';

import { useWorkingTreeStatus } from './useWorkingTreeStatus';

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
  createFooter: css`
    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 8px;
    border-block-start: 1px solid ${cssVar.colorSplit};
  `,
  createItemWrapper: css`
    padding: 4px;
    border-block-start: 1px solid ${cssVar.colorSplit};
  `,
  createItem: css`
    border-radius: calc(${cssVar.borderRadius} - 4px);
  `,
  createInput: css`
    flex: 1;
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
  open: boolean;
  path: string;
  /** Remote working-tree status, supplied by the caller when `deviceId` is set. */
  workingStatus?: { clean: boolean; total: number };
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
    workingStatus: remoteWorkingStatus,
    children,
  }) => {
    const { t } = useTranslation('device');
    const [search, setSearch] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [newBranch, setNewBranch] = useState('');
    const [busyBranch, setBusyBranch] = useState<string | null>(null);
    const createInputRef = useRef<HTMLInputElement>(null);

    const {
      data: branches = [],
      isLoading,
      error: branchesError,
      mutate: mutateBranches,
    } = useSWR(
      open ? ['git-branches', deviceId ?? 'local', path] : null,
      // Desktop talks to Electron over IPC; web / remote device goes through RPC.
      () =>
        deviceId
          ? lambdaClient.device.listGitBranches.query({ deviceId, path })
          : electronGitService.listGitBranches(path),
      { revalidateOnFocus: false, shouldRetryOnError: false },
    );
    // The local working tree is probed over IPC; a remote device's status is
    // passed in by the caller (it can't probe a remote fs here).
    const { data: localWorkingStatus, mutate: mutateWorkingStatus } = useWorkingTreeStatus(
      deviceId ? undefined : path,
    );
    const workingStatus = deviceId ? remoteWorkingStatus : localWorkingStatus;
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
      if (!open) {
        setSearch('');
        setIsCreating(false);
        setNewBranch('');
      }
    }, [open]);

    useEffect(() => {
      if (isCreating) {
        createInputRef.current?.focus();
      }
    }, [isCreating]);

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
        try {
          const result = deviceId
            ? await lambdaClient.device.checkoutGitBranch.mutate({ branch, create, deviceId, path })
            : await electronGitService.checkoutGitBranch({ branch, create, path });
          if (result.success) {
            onAfterCheckout?.();
            onOpenChange(false);
          } else {
            message.error(result.error || t('workingDirectory.checkoutFailed'));
          }
        } finally {
          setBusyBranch(null);
        }
      },
      [busyBranch, currentBranch, deviceId, onAfterCheckout, onOpenChange, path, t],
    );

    const handleCreateSubmit = useCallback(() => {
      const name = newBranch.trim();
      if (!name) return;
      void handleCheckout(name, true);
    }, [handleCheckout, newBranch]);

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

                {isCreating ? (
                  <div className={styles.createFooter}>
                    <Input
                      className={styles.createInput}
                      placeholder={t('workingDirectory.newBranchPlaceholder')}
                      ref={createInputRef as any}
                      size="small"
                      value={newBranch}
                      variant="filled"
                      onChange={(e) => setNewBranch(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      onPressEnter={handleCreateSubmit}
                    />
                    <Button
                      disabled={!newBranch.trim() || !!busyBranch}
                      loading={!!busyBranch}
                      size="small"
                      type="primary"
                      onClick={handleCreateSubmit}
                    >
                      {t('workingDirectory.checkoutAction')}
                    </Button>
                    <Button
                      size="small"
                      type="text"
                      onClick={() => {
                        setIsCreating(false);
                        setNewBranch('');
                      }}
                    >
                      {t('workingDirectory.cancel')}
                    </Button>
                  </div>
                ) : (
                  <div className={styles.createItemWrapper}>
                    <DropdownMenuItem
                      className={cx(styles.item, styles.createItem)}
                      closeOnClick={false}
                      onClick={() => setIsCreating(true)}
                    >
                      <Icon className={styles.itemIcon} icon={GitBranchPlusIcon} size={14} />
                      <div className={styles.itemMain}>
                        {t('workingDirectory.createBranchAction')}
                      </div>
                    </DropdownMenuItem>
                  </div>
                )}
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
