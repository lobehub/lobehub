'use client';

import { ActionIcon, Center, Collapse, Empty, Flexbox } from '@lobehub/ui';
import { Dropdown, type MenuProps, Spin } from 'antd';
import { createStaticStyles } from 'antd-style';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Columns2Icon,
  FoldVerticalIcon,
  GitCompareIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  Rows2Icon,
  UnfoldVerticalIcon,
  WholeWordIcon,
  WrapTextIcon,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocalStorageState } from '@/hooks/useLocalStorageState';

import FileItemBody, { FileItemHeader } from './FileItem';
import { useWorkingTreePatches } from './useWorkingTreePatches';

const WORD_WRAP_STORAGE_KEY = 'lobechat-review-word-wrap';
const TEXT_DIFF_STORAGE_KEY = 'lobechat-review-text-diff';
const VIEW_MODE_STORAGE_KEY = 'lobechat-review-view-mode';

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
    color: ${cssVar.colorTextTertiary};
  `,
  count: css`
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  totalAdditions: css`
    color: ${cssVar.colorSuccess};
  `,
  totalDeletions: css`
    color: ${cssVar.colorError};
  `,
  totalStats: css`
    display: inline-flex;
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
  scopeChip: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
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
  const { data, isLoading, isValidating, mutate } = useWorkingTreePatches(workingDirectory);
  // Memo-stabilise the fallback so downstream useMemo deps don't flap on
  // every render while the SWR result is undefined.
  const patches = useMemo(() => data?.patches ?? [], [data]);
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
        <Spin />
      </Center>
    );
  }

  if (patches.length === 0) {
    return (
      <Center flex={1} gap={8} paddingBlock={24}>
        <Empty description={t('workingPanel.review.empty')} icon={GitCompareIcon} />
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

  return (
    <Flexbox style={{ overflow: 'hidden' }} width={'100%'}>
      <div className={styles.subheader}>
        <Flexbox horizontal align={'center'} gap={8}>
          <span className={styles.scopeChip}>
            {t('workingPanel.review.unstaged')}
            <span className={styles.count}>{patches.length}</span>
            <ChevronDownIcon className={styles.caret} size={12} />
          </span>
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
    </Flexbox>
  );
});

Review.displayName = 'AgentWorkingSidebarReview';

export default Review;
