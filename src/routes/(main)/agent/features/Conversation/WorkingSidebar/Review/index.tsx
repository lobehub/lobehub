'use client';

import { ActionIcon, Center, Collapse, Empty, Flexbox } from '@lobehub/ui';
import { Dropdown, type MenuProps } from 'antd';
import { createStaticStyles } from 'antd-style';
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
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
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';

import FileItemBody, { FileItemHeader } from './FileItem';
import { type ReviewMode, useGitRemoteBranches, useReviewPatches } from './useReviewPatches';

const WORD_WRAP_STORAGE_KEY = 'lobechat-review-word-wrap';
const TEXT_DIFF_STORAGE_KEY = 'lobechat-review-text-diff';
const VIEW_MODE_STORAGE_KEY = 'lobechat-review-view-mode';
const REVIEW_MODE_STORAGE_KEY = 'lobechat-review-mode';
const BASE_REF_OVERRIDES_STORAGE_KEY = 'lobechat-review-base-overrides';

interface ReviewProps {
  workingDirectory: string;
}

// Empirically: ~100KB of patch ≈ 50 small-diff files OR ~2 big refactors;
// either way keeps Shiki tokenization under ~250ms on first paint.
const DEFAULT_EXPAND_BYTE_BUDGET = 100 * 1024;
const DEFAULT_EXPAND_MAX_COUNT = 50;

const itemKey = (entry: { filePath: string; status: string }) =>
  `${entry.status}:${entry.filePath}`;

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
  // Skip layout/paint of off-screen file panels. Each panel still mounts
  // (so React/Shiki state is preserved across scroll), but the browser
  // short-circuits its layout & paint until it scrolls near the viewport.
  // Crucial for repos with many large diffs where ~38+ panels were
  // previously locking the scroll thread on every frame.
  list: css`
    & :where(.ant-collapse-item) {
      content-visibility: auto;
      contain-intrinsic-size: auto 56px;
    }

    /* antd v6 renders the label slot as .ant-collapse-title (was
       .ant-collapse-header-text in v4/v5). When collapsible is 'header'
       (the @lobehub/ui Collapse default), antd applies a (0,4,0) rule
       on .ant-collapse .ant-item .ant-collapsible-header .ant-title
       that locks flex to 0 0 auto — long paths then push stats and
       chevron off-screen instead of triggering ellipsis on .path. Our
       parent-className selector is only (0,3,0), so we !important to win.
       Verified via getComputedStyle on a real row: without !important the
       title resolves to flex: 0 0 auto; with it, flex: 1 1 0%. */
    & .ant-collapse-collapsible-header .ant-collapse-title {
      overflow: hidden !important;
      flex: 1 1 0 !important;
      min-width: 0 !important;
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
}));

const Review = memo<ReviewProps>(({ workingDirectory }) => {
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
  );
  // Lazy: only fetch remote branches list once the user opens the picker.
  const [basePickerOpen, setBasePickerOpen] = useState(false);
  const { data: remoteBranches } = useGitRemoteBranches(
    workingDirectory,
    mode === 'branch' && basePickerOpen,
  );
  // Memo-stabilise the fallback so downstream useMemo deps don't flap on
  // every render while the SWR result is undefined.
  const patches = useMemo(() => data?.patches ?? [], [data]);
  const baseRef = data?.mode === 'branch' ? data.baseRef : undefined;
  const headRef = data?.mode === 'branch' ? data.headRef : undefined;
  const [viewMode, setViewMode] = useLocalStorageState<'unified' | 'split'>(
    VIEW_MODE_STORAGE_KEY,
    'unified',
  );
  const [wordWrap, setWordWrap] = useLocalStorageState<boolean>(WORD_WRAP_STORAGE_KEY, false);
  // pierre/diffs default lineDiffType is 'word-alt' (text-level highlighting on),
  // so we default the persisted toggle to true to preserve current behaviour.
  const [textDiff, setTextDiff] = useLocalStorageState<boolean>(TEXT_DIFF_STORAGE_KEY, true);

  // Default-expand by patch-size budget: take entries until cumulative patch
  // bytes exceed DEFAULT_EXPAND_BYTE_BUDGET, capped at DEFAULT_EXPAND_MAX_COUNT.
  // Every PatchDiff mounts a Shiki tokenizer synchronously, so expanding too
  // much at once locks the renderer; size-based budget keeps small-diff cases
  // generous while clamping repos with a few large refactors. Re-syncing on
  // signature change auto-expands new entries within the cap; panels the user
  // manually closed earlier stay closed because their key is already absent.
  const signature = useMemo(() => patches.map(itemKey).join('|'), [patches]);
  const [seenSignature, setSeenSignature] = useState('');
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  if (signature !== seenSignature) {
    setSeenSignature(signature);
    const initialKeys: string[] = [];
    let budget = DEFAULT_EXPAND_BYTE_BUDGET;
    for (const entry of patches) {
      if (initialKeys.length >= DEFAULT_EXPAND_MAX_COUNT) break;
      const cost = entry.patch?.length ?? 0;
      if (initialKeys.length > 0 && cost > budget) break;
      initialKeys.push(itemKey(entry));
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

  const items = patches.map((entry) => {
    const key = itemKey(entry);
    return {
      children: (
        <FileItemBody
          expanded={activeKeys.includes(key)}
          filePath={entry.filePath}
          isBinary={entry.isBinary}
          patch={entry.patch}
          textDiff={textDiff}
          truncated={entry.truncated}
          viewMode={viewMode}
          wordWrap={wordWrap}
        />
      ),
      key,
      label: (
        <FileItemHeader
          additions={entry.additions}
          deletions={entry.deletions}
          filePath={entry.filePath}
          onReverted={() => void mutate()}
          // Revert is only meaningful for working-tree changes; in branch-diff
          // mode there's nothing to "discard" on the file system.
          revertContext={mode === 'unstaged' ? { workingDirectory } : undefined}
          status={entry.status}
        />
      ),
    };
  });

  const allExpanded = patches.length > 0 && activeKeys.length === patches.length;
  const handleToggleAll = () => {
    setActiveKeys(allExpanded ? [] : patches.map(itemKey));
  };

  const totals = patches.reduce(
    (acc, entry) => {
      acc.additions += entry.additions ?? 0;
      acc.deletions += entry.deletions ?? 0;
      return acc;
    },
    { additions: 0, deletions: 0 },
  );

  const moreMenuItems: MenuProps['items'] = [
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

  const modeMenuItems: MenuProps['items'] = [
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
  const baseRefMenuItems: MenuProps['items'] = remoteBranches
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

  const isEmpty = patches.length === 0;
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
          <Dropdown
            menu={{ items: modeMenuItems, selectedKeys: [mode] }}
            placement={'bottomLeft'}
            trigger={['click']}
          >
            <span className={styles.scopeChip} role={'button'} tabIndex={0}>
              {mode === 'branch'
                ? t('workingPanel.review.mode.branch')
                : t('workingPanel.review.mode.unstaged')}
              <ChevronDownIcon className={styles.caret} size={12} />
            </span>
          </Dropdown>
          {mode === 'branch' && (baseRef || headRef) && (
            <span className={styles.compareChip}>
              <Dropdown
                placement={'bottomLeft'}
                trigger={['click']}
                menu={{
                  items: baseRefMenuItems,
                  selectedKeys: baseRef ? [baseRef] : [],
                }}
                onOpenChange={setBasePickerOpen}
              >
                <span className={styles.basePicker} role={'button'} tabIndex={0}>
                  <span className={styles.refName}>
                    {baseRef ?? t('workingPanel.review.baseRef.unresolved')}
                  </span>
                  <ChevronDownIcon className={styles.caret} size={12} />
                </span>
              </Dropdown>
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
          {!isEmpty && (
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
          <Dropdown menu={{ items: moreMenuItems }} placement={'bottomRight'} trigger={['click']}>
            <ActionIcon
              icon={MoreHorizontalIcon}
              loading={isValidating}
              size={'small'}
              title={t('workingPanel.review.more')}
            />
          </Dropdown>
        </Flexbox>
      </div>
      {isEmpty ? (
        <Center flex={1} gap={8} paddingBlock={24}>
          <Empty description={emptyText} icon={GitCompareIcon} />
        </Center>
      ) : (
        <Flexbox
          className={styles.list}
          gap={6}
          paddingInline={8}
          style={{ overflow: 'auto' }}
          width={'100%'}
        >
          <Collapse
            activeKey={activeKeys}
            expandIconPlacement={'end'}
            items={items}
            padding={{ body: 0, header: '6px 12px' }}
            variant={'outlined'}
            expandIcon={({ isActive }) => (
              <ChevronRightIcon
                size={14}
                style={{
                  color: 'var(--ant-color-text-tertiary)',
                  transform: isActive ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                }}
              />
            )}
            onChange={(next) => setActiveKeys(Array.isArray(next) ? next : [next])}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

Review.displayName = 'AgentWorkingSidebarReview';

export default Review;
