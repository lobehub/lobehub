'use client';

import type { GitWorkingTreePatch } from '@lobechat/electron-client-ipc';
import { ActionIcon, Center, type DropdownItem, DropdownMenu, Empty, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  Columns2Icon,
  FoldVerticalIcon,
  GitCompareIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Rows2Icon,
  UnfoldVerticalIcon,
  WholeWordIcon,
  WrapTextIcon,
} from 'lucide-react';
import path from 'path-browserify-esm';
import { Fragment, memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { useFetchGitBranch } from '@/store/device';

import FileRow from './FileRow';
import GroupHeader from './GroupHeader';
import { type ReviewMode, useGitRemoteBranches, useReviewPatches } from './useReviewPatches';

interface RepoGroup {
  absolutePath: string;
  branch?: string;
  detached?: boolean;
  isParent: boolean;
  name: string;
  patches: GitWorkingTreePatch[];
}

const WORD_WRAP_STORAGE_KEY = 'lobechat-review-word-wrap';
const TEXT_DIFF_STORAGE_KEY = 'lobechat-review-text-diff';
const VIEW_MODE_STORAGE_KEY = 'lobechat-review-view-mode';
const REVIEW_MODE_STORAGE_KEY = 'lobechat-review-mode';
const BASE_REF_OVERRIDES_STORAGE_KEY = 'lobechat-review-base-overrides';

interface ReviewProps {
  /**
   * Target device the working directory lives on. Undefined for local desktop;
   * set for a remote / web-bound device so git ops route through the device RPCs.
   */
  deviceId?: string;
  workingDirectory: string;
}

// Empirically: ~100KB of patch ≈ 50 small-diff files OR ~2 big refactors;
// either way keeps Shiki tokenization under ~250ms on first paint.
const DEFAULT_EXPAND_BYTE_BUDGET = 100 * 1024;
const DEFAULT_EXPAND_MAX_COUNT = 50;

const itemKey = (groupPath: string, entry: { filePath: string; status: string }): string =>
  `${groupPath}|${entry.status}:${entry.filePath}`;

const styles = createStaticStyles(({ css, cssVar }) => ({
  caret: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  totalAdditions: css`
    color: ${cssVar.colorSuccess};
  `,
  totalDeletions: css`
    color: ${cssVar.colorError};
  `,
  totalStats: css`
    display: inline-flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  `,
  list: css`
    position: relative;
    border-block: 1px solid ${cssVar.colorBorderSecondary};

    /* Strip the first visible row's own top border — the list's
       border-block-start already provides the separator under the subheader,
       so without this we'd render a doubled-up 2px line at the top. */
    & > :first-child {
      border-block-start: none;
    }
  `,
  arrow: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  basePicker: css`
    cursor: pointer;
    user-select: none;

    overflow: hidden;
    display: inline-flex;
    flex: 0 1 auto;
    gap: 4px;
    align-items: center;

    min-width: 0;
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    transition: background 0.15s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  compareChip: css`
    overflow: hidden;
    display: inline-flex;
    flex: 0 1 auto;
    gap: 6px;
    align-items: center;

    min-width: 0;
  `,
  headRefText: css`
    overflow: hidden;
    flex: 0 1 auto;

    min-width: 0;
    padding-inline-end: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  refName: css`
    overflow: hidden;
    flex: 0 1 auto;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  scopeChip: css`
    cursor: pointer;
    user-select: none;

    display: inline-flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 6px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    transition: background 0.15s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  subheader: css`
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 4px 8px;
    padding-inline: 8px;
  `,
  // Empty submodule group — pointer-only bump where the submodule's own
  // working tree is clean. We still surface the group so the user knows the
  // submodule pointer moved, just with a softer "no changes" line instead of
  // a list of files.
  groupEmpty: css`
    padding-block: 6px 10px;
    padding-inline: 10px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const Review = memo<ReviewProps>(({ deviceId, workingDirectory }) => {
  const { t } = useTranslation('chat');
  const [mode, setMode] = useLocalStorageState<ReviewMode>(REVIEW_MODE_STORAGE_KEY, 'unstaged');
  // Per-repo base-ref override — when set, the branch diff compares against
  // this ref instead of `origin/HEAD`. Stored as a single keyed object so we
  // don't proliferate localStorage keys across repos.
  const [baseOverrides, setBaseOverrides] = useLocalStorageState<Record<string, string>>(
    BASE_REF_OVERRIDES_STORAGE_KEY,
    {},
  );
  const baseOverride = baseOverrides[workingDirectory];
  const setBaseOverride = (next: string | undefined) => {
    setBaseOverrides((prev) => {
      const updated = { ...prev };
      if (next === undefined) delete updated[workingDirectory];
      else updated[workingDirectory] = next;
      return updated;
    });
  };

  const { data, isLoading, isValidating, mutate } = useReviewPatches(
    workingDirectory,
    mode,
    baseOverride,
    deviceId,
  );
  // Lazy: only fetch remote branches list once the user opens the picker.
  const [basePickerOpen, setBasePickerOpen] = useState(false);
  const { data: remoteBranches } = useGitRemoteBranches(
    workingDirectory,
    mode === 'branch' && basePickerOpen,
    deviceId,
  );
  // Memo-stabilise the fallback so downstream useMemo deps don't flap on
  // every render while the SWR result is undefined.
  const patches = useMemo(() => data?.patches ?? [], [data]);
  const submoduleGroups = useMemo(() => data?.submodules ?? [], [data]);
  const baseRef = data?.mode === 'branch' ? data.baseRef : undefined;
  const headRef = data?.mode === 'branch' ? data.headRef : undefined;
  // Parent branch — only needed for the group header label, so we only fetch
  // it when there's at least one submodule group to render alongside it.
  // SWR-deduped under the hood by `useFetchGitBranch`'s own cache key. Routes
  // through the target device so remote repos resolve the same way.
  const { data: parentGitInfo } = useFetchGitBranch(
    deviceId,
    submoduleGroups.length > 0 ? workingDirectory : undefined,
  );
  const [viewMode, setViewMode] = useLocalStorageState<'unified' | 'split'>(
    VIEW_MODE_STORAGE_KEY,
    'unified',
  );
  const [wordWrap, setWordWrap] = useLocalStorageState<boolean>(WORD_WRAP_STORAGE_KEY, false);
  // pierre/diffs default lineDiffType is 'word-alt' (text-level highlighting on),
  // so we default the persisted toggle to true to preserve current behaviour.
  const [textDiff, setTextDiff] = useLocalStorageState<boolean>(TEXT_DIFF_STORAGE_KEY, true);

  // Build the per-repo group list. The parent always comes first; submodules
  // follow in the order the IPC returned them (which is the order they appear
  // in `git status`). The parent group is dropped when it has zero patches
  // *and* at least one submodule exists — we don't want an empty parent
  // header hovering above the submodule rows. Submodule groups with zero
  // patches (pointer-only bumps) are intentionally kept so the user still
  // sees the submodule surfaced.
  const groups = useMemo<RepoGroup[]>(() => {
    const result: RepoGroup[] = [];
    if (patches.length > 0 || submoduleGroups.length === 0) {
      result.push({
        absolutePath: workingDirectory,
        branch: parentGitInfo?.branch,
        detached: parentGitInfo?.detached,
        isParent: true,
        name: path.basename(workingDirectory) || workingDirectory,
        patches,
      });
    }
    for (const sub of submoduleGroups) {
      result.push({
        absolutePath: sub.absolutePath,
        branch: sub.branch,
        detached: sub.detached,
        isParent: false,
        name: sub.name,
        patches: sub.patches,
      });
    }
    return result;
  }, [workingDirectory, parentGitInfo?.branch, parentGitInfo?.detached, patches, submoduleGroups]);
  const showGroupHeaders = submoduleGroups.length > 0;
  const allEntries = useMemo(
    () => groups.flatMap((g) => g.patches.map((p) => ({ group: g, patch: p }))),
    [groups],
  );
  // Per-group collapse state — ephemeral (not persisted across reloads).
  // Stored as a set of repo absolutePaths; entries linger if a group later
  // disappears, which is harmless since nothing renders for missing paths.
  const [collapsedGroupPaths, setCollapsedGroupPaths] = useState<Set<string>>(() => new Set());
  const toggleGroupCollapsed = (absolutePath: string) => {
    setCollapsedGroupPaths((prev) => {
      const next = new Set(prev);
      if (next.has(absolutePath)) next.delete(absolutePath);
      else next.add(absolutePath);
      return next;
    });
  };

  // Default-expand by patch-size budget: take entries (across all groups in
  // order) until cumulative patch bytes exceed DEFAULT_EXPAND_BYTE_BUDGET,
  // capped at DEFAULT_EXPAND_MAX_COUNT. Every PatchDiff mounts a Shiki
  // tokenizer synchronously, so expanding too much at once locks the renderer;
  // size-based budget keeps small-diff cases generous while clamping repos
  // with a few large refactors. Re-syncing on signature change auto-expands
  // new entries within the cap; panels the user manually closed earlier stay
  // closed because their key is already absent.
  const signature = useMemo(
    () => allEntries.map(({ group, patch }) => itemKey(group.absolutePath, patch)).join('|'),
    [allEntries],
  );
  const [seenSignature, setSeenSignature] = useState('');
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  if (signature !== seenSignature) {
    setSeenSignature(signature);
    const initialKeys: string[] = [];
    let budget = DEFAULT_EXPAND_BYTE_BUDGET;
    for (const { group, patch } of allEntries) {
      if (initialKeys.length >= DEFAULT_EXPAND_MAX_COUNT) break;
      const cost = patch.patch?.length ?? 0;
      if (initialKeys.length > 0 && cost > budget) break;
      initialKeys.push(itemKey(group.absolutePath, patch));
      budget -= cost;
    }
    setActiveKeys(initialKeys);
  }

  if (!data && isLoading) {
    return (
      <Center flex={1}>
        <NeuralNetworkLoading size={48} />
      </Center>
    );
  }

  const totalEntryCount = allEntries.length;
  const allExpanded = totalEntryCount > 0 && activeKeys.length === totalEntryCount;
  const handleToggleAll = () => {
    setActiveKeys(
      allExpanded ? [] : allEntries.map(({ group, patch }) => itemKey(group.absolutePath, patch)),
    );
  };

  const totals = allEntries.reduce(
    (acc, { patch }) => {
      acc.additions += patch.additions ?? 0;
      acc.deletions += patch.deletions ?? 0;
      return acc;
    },
    { additions: 0, deletions: 0 },
  );

  const moreMenuItems: DropdownItem[] = [
    {
      icon: <RefreshCwIcon size={14} />,
      key: 'refresh',
      label: t('workingPanel.review.refresh'),
      onClick: () => void mutate(),
    },
    { type: 'divider' },
    {
      icon: <WrapTextIcon size={14} />,
      key: 'wordWrap',
      label: wordWrap
        ? t('workingPanel.review.wordWrap.disable')
        : t('workingPanel.review.wordWrap.enable'),
      onClick: () => setWordWrap((w) => !w),
    },
    {
      icon: <WholeWordIcon size={14} />,
      key: 'textDiff',
      label: textDiff
        ? t('workingPanel.review.textDiff.disable')
        : t('workingPanel.review.textDiff.enable'),
      onClick: () => setTextDiff((v) => !v),
    },
    {
      icon: viewMode === 'unified' ? <Columns2Icon size={14} /> : <Rows2Icon size={14} />,
      key: 'viewMode',
      label:
        viewMode === 'unified'
          ? t('workingPanel.review.viewMode.split')
          : t('workingPanel.review.viewMode.unified'),
      onClick: () => setViewMode((m) => (m === 'unified' ? 'split' : 'unified')),
    },
  ];

  const modeMenuItems: DropdownItem[] = [
    {
      key: 'unstaged',
      label: t('workingPanel.review.mode.unstaged'),
      onClick: () => setMode('unstaged'),
    },
    {
      key: 'branch',
      label: t('workingPanel.review.mode.branch'),
      onClick: () => setMode('branch'),
    },
  ];

  // Branches are only loaded after the user opens the picker (see
  // `basePickerOpen`). While loading, render a single disabled placeholder
  // so the menu doesn't pop empty + jump to its final size.
  const baseRefMenuItems: DropdownItem[] = remoteBranches
    ? [
        ...remoteBranches.map((branch) => ({
          key: branch.name,
          label: branch.isDefault
            ? `${branch.name} · ${t('workingPanel.review.baseRef.default')}`
            : branch.name,
          onClick: () =>
            setBaseOverride(branch.isDefault && !baseOverride ? undefined : branch.name),
        })),
        ...(baseOverride
          ? [
              { type: 'divider' as const },
              {
                icon: <RotateCcwIcon size={14} />,
                key: 'reset',
                label: t('workingPanel.review.baseRef.reset'),
                onClick: () => setBaseOverride(undefined),
              },
            ]
          : []),
      ]
    : [
        {
          disabled: true,
          key: 'loading',
          label: t('workingPanel.review.baseRef.loading'),
        },
      ];

  // A pointer-only submodule bump produces a group with no file patches but is
  // still worth surfacing (the GroupHeader + "submodule clean" line), so don't
  // collapse into the global empty state when any submodule group is present.
  const isEmpty = totalEntryCount === 0 && submoduleGroups.length === 0;
  const emptyText =
    mode === 'branch'
      ? baseRef
        ? t('workingPanel.review.empty.branch', { baseRef })
        : t('workingPanel.review.empty.noBaseRef')
      : t('workingPanel.review.empty');

  return (
    <Flexbox style={{ overflow: 'hidden' }} width={'100%'}>
      <div className={styles.subheader}>
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}
        >
          <DropdownMenu items={modeMenuItems} placement={'bottomLeft'}>
            <span className={styles.scopeChip} role={'button'} tabIndex={0}>
              {mode === 'branch'
                ? t('workingPanel.review.mode.branch')
                : t('workingPanel.review.mode.unstaged')}
              <ChevronDownIcon className={styles.caret} size={12} />
            </span>
          </DropdownMenu>
          {mode === 'branch' && (baseRef || headRef) && (
            <span className={styles.compareChip}>
              <DropdownMenu
                items={baseRefMenuItems}
                placement={'bottomLeft'}
                onOpenChange={setBasePickerOpen}
              >
                <span className={styles.basePicker} role={'button'} tabIndex={0}>
                  <span className={styles.refName}>
                    {baseRef ?? t('workingPanel.review.baseRef.unresolved')}
                  </span>
                  <ChevronDownIcon className={styles.caret} size={12} />
                </span>
              </DropdownMenu>
              {headRef && (
                <>
                  <ArrowLeftIcon className={styles.arrow} size={12} />
                  <span className={styles.headRefText}>{headRef}</span>
                </>
              )}
            </span>
          )}
          {(totals.additions > 0 || totals.deletions > 0) && (
            <span className={styles.totalStats}>
              {totals.additions > 0 && (
                <span className={styles.totalAdditions}>+{totals.additions}</span>
              )}
              {totals.deletions > 0 && (
                <span className={styles.totalDeletions}>-{totals.deletions}</span>
              )}
            </span>
          )}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={2}>
          {totalEntryCount > 0 && (
            <ActionIcon
              icon={allExpanded ? FoldVerticalIcon : UnfoldVerticalIcon}
              size={'small'}
              title={
                allExpanded
                  ? t('workingPanel.review.collapseAll')
                  : t('workingPanel.review.expandAll')
              }
              onClick={handleToggleAll}
            />
          )}
          <DropdownMenu items={moreMenuItems} placement={'bottomRight'}>
            <ActionIcon
              icon={MoreHorizontalIcon}
              loading={isValidating}
              size={'small'}
              title={t('workingPanel.review.more')}
            />
          </DropdownMenu>
        </Flexbox>
      </div>
      {isEmpty ? (
        <Center flex={1} gap={8} paddingBlock={24}>
          <Empty description={emptyText} icon={GitCompareIcon} />
        </Center>
      ) : (
        <Flexbox className={styles.list} style={{ overflow: 'auto' }} width={'100%'}>
          {groups.map((group) => {
            const groupTotals = group.patches.reduce(
              (acc, p) => {
                acc.additions += p.additions ?? 0;
                acc.deletions += p.deletions ?? 0;
                return acc;
              },
              { additions: 0, deletions: 0 },
            );
            const groupCollapsed = collapsedGroupPaths.has(group.absolutePath);
            const groupItemKeys = group.patches.map((p) => itemKey(group.absolutePath, p));
            const groupAllExpanded =
              groupItemKeys.length > 0 && groupItemKeys.every((k) => activeKeys.includes(k));
            const toggleGroupDiffs = () => {
              setActiveKeys((prev) => {
                if (groupAllExpanded) {
                  const set = new Set(groupItemKeys);
                  return prev.filter((k) => !set.has(k));
                }
                const next = new Set(prev);
                for (const k of groupItemKeys) next.add(k);
                return Array.from(next);
              });
            };
            return (
              <Fragment key={group.absolutePath}>
                {showGroupHeaders && (
                  <GroupHeader
                    branch={group.branch}
                    collapsed={groupCollapsed}
                    diffsAllExpanded={groupAllExpanded}
                    hideFoldButton={groupCollapsed || group.patches.length === 0}
                    name={group.name}
                    patchCount={group.patches.length}
                    totalAdditions={groupTotals.additions}
                    totalDeletions={groupTotals.deletions}
                    onToggleCollapsed={() => toggleGroupCollapsed(group.absolutePath)}
                    onToggleDiffs={toggleGroupDiffs}
                  />
                )}
                {showGroupHeaders &&
                  !groupCollapsed &&
                  !group.isParent &&
                  group.patches.length === 0 && (
                    <div className={styles.groupEmpty}>
                      {t('workingPanel.review.group.submoduleClean')}
                    </div>
                  )}
                {!groupCollapsed &&
                  group.patches.map((entry) => {
                    const key = itemKey(group.absolutePath, entry);
                    const expanded = activeKeys.includes(key);
                    return (
                      <FileRow
                        deviceId={deviceId}
                        entry={entry}
                        expanded={expanded}
                        key={key}
                        mode={mode}
                        repoAbsolutePath={group.absolutePath}
                        textDiff={textDiff}
                        viewMode={viewMode}
                        wordWrap={wordWrap}
                        onReverted={() => void mutate()}
                        onToggle={() =>
                          setActiveKeys((prev) =>
                            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
                          )
                        }
                      />
                    );
                  })}
              </Fragment>
            );
          })}
        </Flexbox>
      )}
    </Flexbox>
  );
});

Review.displayName = 'AgentWorkingSidebarReview';

export default Review;
