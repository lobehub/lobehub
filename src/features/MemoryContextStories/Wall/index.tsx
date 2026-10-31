import { type MemoryContextStoryList, type UserMemoryDossierStatus } from '@lobechat/types';
import { Button, Empty, Icon, SearchBar } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArchiveIcon, ChevronDownIcon, ChevronUpIcon, SearchXIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';

import { groupStories } from '../derive';
import { useStoryFormat } from '../format';
import StoryCard from './StoryCard';

const styles = stylex.create({
  scroll: { flex: '1', height: '100%', minWidth: 0, overflowY: 'auto' },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
    marginInline: 'auto',
    maxWidth: '1120px',
    paddingBlockEnd: '96px',
    paddingBlockStart: '32px',
    paddingInline: '32px',
  },
  head: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '16px',
    justifyContent: 'space-between',
  },
  heading: { alignItems: 'baseline', display: 'flex', gap: '8px' },
  title: { fontSize: '20px', fontWeight: 600, lineHeight: '28px', margin: 0 },
  count: { color: cssVar.colorTextTertiary, fontSize: '13px', fontVariantNumeric: 'tabular-nums' },
  search: { maxWidth: '100%', width: '280px' },
  group: { display: 'flex', flexDirection: 'column', gap: '12px' },
  groupHead: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '8px' },
  groupTitle: { fontSize: '14px', fontWeight: 600, margin: 0 },
  groupMeta: { color: cssVar.colorTextTertiary, fontSize: '12px' },
  grid: {
    display: 'grid',
    gap: '12px',
    // `min()` lets a phone fall back to one column instead of overflowing.
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))',
  },
  gridCompact: { gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))' },
  toggle: { alignSelf: 'flex-start', color: cssVar.colorTextSecondary },
  legacy: {
    alignItems: 'center',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: '1px',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: '13px',
    gap: '8px',
    paddingBlockStart: '20px',
  },
  noMatch: { paddingBlock: '48px' },
});

interface StoryWallProps {
  data: MemoryContextStoryList;
  onOpen: (id: string) => void;
  onOpenLegacy: () => void;
}

/**
 * What memory holds about what you are working on: ongoing stories first and largest, quiet ones
 * smaller, finished ones folded away.
 */
const StoryWall = memo<StoryWallProps>(({ data, onOpen, onOpenLegacy }) => {
  const format = useStoryFormat();
  const { t } = format;
  const [keyword, setKeyword] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const needle = keyword.trim();
  const groups = useMemo(() => groupStories(data.stories, needle), [data.stories, needle]);
  const matched = groups.reduce((sum, g) => sum + g.stories.length, 0);
  const legacyCapped = data.legacyCount >= data.legacyCap;

  const renderGroup = (status: UserMemoryDossierStatus, count: number, body: ReactNode) => (
    <section aria-label={t(`story.group.${status}`)} key={status} {...stylex.props(styles.group)}>
      <div {...stylex.props(styles.groupHead)}>
        <h2 {...stylex.props(styles.groupTitle)}>{t(`story.group.${status}`)}</h2>
        <span {...stylex.props(styles.groupMeta)}>
          {count} · {t(`story.group.${status}.desc`)}
        </span>
      </div>
      {body}
    </section>
  );

  return (
    <main aria-label={t('story.title')} {...stylex.props(styles.scroll)}>
      <div {...stylex.props(styles.column)}>
        <header {...stylex.props(styles.head)}>
          <div {...stylex.props(styles.heading)}>
            <h1 {...stylex.props(styles.title)}>{t('story.title')}</h1>
            <span {...stylex.props(styles.count)}>
              {needle ? `${matched} / ${data.stories.length}` : data.stories.length}
            </span>
          </div>
          <div {...stylex.props(styles.search)}>
            <SearchBar
              allowClear
              placeholder={t('story.searchPlaceholder')}
              value={keyword}
              variant={'filled'}
              onInputChange={setKeyword}
            />
          </div>
        </header>

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
            const compact = status !== 'active';
            // Finished stories stay folded unless a search is narrowing the wall.
            const folded = status === 'closed' && !showClosed && !needle;
            const grid = (
              <div {...stylex.props(styles.grid, compact && styles.gridCompact)}>
                {stories.map((story) => (
                  <StoryCard compact={compact} key={story.id} story={story} onOpen={onOpen} />
                ))}
              </div>
            );
            if (status !== 'closed' || needle) return renderGroup(status, stories.length, grid);

            return renderGroup(
              status,
              stories.length,
              <>
                {!folded && grid}
                <Button
                  icon={<Icon icon={folded ? ChevronDownIcon : ChevronUpIcon} />}
                  size={'small'}
                  type={'text'}
                  {...stylex.props(styles.toggle)}
                  onClick={() => setShowClosed(!showClosed)}
                >
                  {folded
                    ? t('story.group.closed.show', { count: stories.length })
                    : t('story.group.closed.hide')}
                </Button>
              </>,
            );
          })
        )}

        {data.legacyCount > 0 && !needle && (
          <footer {...stylex.props(styles.legacy)}>
            <Icon icon={ArchiveIcon} size={14} />
            <span>
              {t(legacyCapped ? 'story.legacy.countCapped' : 'story.legacy.count', {
                count: data.legacyCount,
              })}
            </span>
            <Button size={'small'} type={'link'} onClick={onOpenLegacy}>
              {t('story.legacy.open')}
            </Button>
          </footer>
        )}
      </div>
    </main>
  );
});

StoryWall.displayName = 'StoryWall';

export default StoryWall;
