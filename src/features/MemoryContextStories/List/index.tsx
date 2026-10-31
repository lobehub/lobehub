import { type MemoryContextStoryList } from '@lobechat/types';
import { Button, Empty, Icon, SearchBar } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArchiveIcon, ChevronDownIcon, ChevronRightIcon, SearchXIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { groupStories } from '../derive';
import { useStoryFormat } from '../format';
import ListItem from './ListItem';

const styles = stylex.create({
  root: {
    borderInlineEndColor: cssVar.colorBorderSecondary,
    borderInlineEndStyle: 'solid',
    borderInlineEndWidth: '1px',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    height: '100%',
    width: '320px',
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    paddingBlockEnd: '8px',
    paddingBlockStart: '20px',
    paddingInline: '16px',
  },
  heading: { alignItems: 'baseline', display: 'flex', gap: '8px' },
  title: { fontSize: '16px', fontWeight: 600, margin: 0 },
  count: { color: cssVar.colorTextTertiary, fontSize: '12px', fontVariantNumeric: 'tabular-nums' },
  scroll: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '20px',
    overflowY: 'auto',
    paddingBlockEnd: '24px',
    paddingBlockStart: '8px',
    paddingInline: '8px',
  },
  group: { display: 'flex', flexDirection: 'column', gap: '2px' },
  groupLabel: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderStyle: 'none',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    fontSize: '12px',
    gap: '6px',
    paddingBlock: 0,
    paddingBlockEnd: '4px',
    paddingInline: '8px',
    textAlign: 'start',
  },
  groupToggle: { cursor: 'pointer' },
  groupName: { color: cssVar.colorTextSecondary, fontWeight: 500 },
  noMatch: { paddingBlock: '48px' },
  legacy: {
    alignItems: 'center',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: '1px',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    flexShrink: 0,
    fontSize: '12px',
    gap: '8px',
    paddingBlock: '12px',
    paddingInline: '16px',
  },
  legacyText: { flex: '1', minWidth: 0 },
});

interface StoryListProps {
  data: MemoryContextStoryList;
  onOpenLegacy: () => void;
  onSelect: (id: string) => void;
  selectedId?: string;
}

/** Contexts by status: ongoing first, quiet next, finished folded unless searching. */
const StoryList = memo<StoryListProps>(({ data, onOpenLegacy, onSelect, selectedId }) => {
  const format = useStoryFormat();
  const { t } = format;
  const [keyword, setKeyword] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const needle = keyword.trim();
  const stories = useMemo(() => data.stories ?? [], [data.stories]);
  const groups = useMemo(() => groupStories(stories, needle), [stories, needle]);
  const matched = groups.reduce((sum, g) => sum + g.stories.length, 0);
  // The open story stays visible even when its group is folded.
  const selectedClosed = groups.some(
    (g) => g.status === 'closed' && g.stories.some((s) => s.id === selectedId),
  );

  return (
    <aside aria-label={t('story.title')} {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.heading)}>
          <h1 {...stylex.props(styles.title)}>{t('story.title')}</h1>
          <span {...stylex.props(styles.count)}>
            {needle ? `${matched} / ${stories.length}` : stories.length}
          </span>
        </div>
        <SearchBar
          allowClear
          placeholder={t('story.searchPlaceholder')}
          value={keyword}
          variant={'filled'}
          onInputChange={setKeyword}
        />
      </div>
      <div {...stylex.props(styles.scroll)}>
        {matched === 0 ? (
          <div {...stylex.props(styles.noMatch)}>
            <Empty
              action={<Button onClick={() => setKeyword('')}>{t('story.clearSearch')}</Button>}
              description={t('story.noMatch', { keyword: needle })}
              icon={SearchXIcon}
            />
          </div>
        ) : (
          groups.map(({ status, stories }) => {
            if (stories.length === 0) return null;
            const foldable = status === 'closed' && !needle;
            const open = !foldable || showClosed || selectedClosed;
            const label = (
              <>
                {foldable && <Icon icon={open ? ChevronDownIcon : ChevronRightIcon} size={12} />}
                <span {...stylex.props(styles.groupName)}>{t(`story.group.${status}`)}</span>
                <span>{stories.length}</span>
              </>
            );
            return (
              <section
                aria-label={t(`story.group.${status}`)}
                key={status}
                {...stylex.props(styles.group)}
              >
                {foldable ? (
                  <button
                    aria-expanded={open}
                    title={t(`story.group.${status}.desc`)}
                    type={'button'}
                    {...stylex.props(styles.groupLabel, styles.groupToggle)}
                    onClick={() => setShowClosed(!open)}
                  >
                    {label}
                  </button>
                ) : (
                  <div title={t(`story.group.${status}.desc`)} {...stylex.props(styles.groupLabel)}>
                    {label}
                  </div>
                )}
                {open &&
                  stories.map((story) => (
                    <ListItem
                      active={story.id === selectedId}
                      key={story.id}
                      story={story}
                      onSelect={onSelect}
                    />
                  ))}
              </section>
            );
          })
        )}
      </div>
      {data.legacyCount > 0 && (
        <div {...stylex.props(styles.legacy)}>
          <Icon icon={ArchiveIcon} size={14} />
          <span {...stylex.props(styles.legacyText)}>
            {t(
              data.legacyCount >= data.legacyCap
                ? 'story.legacy.countCapped'
                : 'story.legacy.count',
              {
                count: data.legacyCount,
              },
            )}
          </span>
          <Button size={'small'} type={'link'} onClick={onOpenLegacy}>
            {t('story.legacy.open')}
          </Button>
        </div>
      )}
    </aside>
  );
});

StoryList.displayName = 'StoryList';

export default StoryList;
