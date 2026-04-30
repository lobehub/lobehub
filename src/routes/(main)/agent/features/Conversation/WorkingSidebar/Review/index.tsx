'use client';

import { ActionIcon, Center, Collapse, Empty, Flexbox } from '@lobehub/ui';
import { Spin } from 'antd';
import { createStaticStyles } from 'antd-style';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Columns2Icon,
  GitCompareIcon,
  Rows2Icon,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileItemBody, { FileItemHeader } from './FileItem';
import { useWorkingTreePatches } from './useWorkingTreePatches';

interface ReviewProps {
  workingDirectory: string;
}

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
  const { data, isLoading } = useWorkingTreePatches(workingDirectory);
  // Memo-stabilise the fallback so downstream useMemo deps don't flap on
  // every render while the SWR result is undefined.
  const patches = useMemo(() => data?.patches ?? [], [data]);
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');

  // Default-expand every entry (Codex-style review). Re-syncing on signature
  // change auto-expands files the agent writes during the panel being open;
  // panels the user manually closed earlier stay closed because their key is
  // already absent.
  const signature = useMemo(() => patches.map(itemKey).join('|'), [patches]);
  const [seenSignature, setSeenSignature] = useState('');
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  if (signature !== seenSignature) {
    setSeenSignature(signature);
    setActiveKeys(patches.map(itemKey));
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
          truncated={entry.truncated}
          viewMode={viewMode}
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

  return (
    <Flexbox style={{ overflow: 'hidden' }} width={'100%'}>
      <div className={styles.subheader}>
        <span className={styles.scopeChip}>
          {t('workingPanel.review.unstaged')}
          <span className={styles.count}>{patches.length}</span>
          <ChevronDownIcon className={styles.caret} size={12} />
        </span>
        <ActionIcon
          active={viewMode === 'split'}
          icon={viewMode === 'unified' ? Columns2Icon : Rows2Icon}
          size={'small'}
          title={
            viewMode === 'unified'
              ? t('workingPanel.review.viewMode.split')
              : t('workingPanel.review.viewMode.unified')
          }
          onClick={() => setViewMode((m) => (m === 'unified' ? 'split' : 'unified'))}
        />
      </div>
      <Flexbox gap={6} paddingInline={8} style={{ overflow: 'auto' }} width={'100%'}>
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
