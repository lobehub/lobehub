import { Button, Empty, SearchBar } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useDebounce } from 'ahooks';
import { SearchXIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { useEntityDataContext } from '../context';
import { lastTouchedOf, searchMatches } from '../derive';
import { useEntityFormat } from '../format';
import { CONTEXT_KINDS } from '../kinds';
import { useRemoteContextSearch } from '../useEntityData';
import { useSelection } from '../useSelection';
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
  title: { fontSize: '17px', fontWeight: 600, margin: 0 },
  count: { color: cssVar.colorTextTertiary, fontSize: '13px' },
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
    alignItems: 'baseline',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    fontSize: '12px',
    gap: '6px',
    paddingBlockEnd: '4px',
    paddingInline: '8px',
  },
  groupName: { color: cssVar.colorTextSecondary, fontWeight: 500 },
  noMatch: { paddingBlock: '48px' },
  more: { color: cssVar.colorTextSecondary, flexShrink: 0 },
});

const EntityList = memo(() => {
  const [keyword, setKeyword] = useState('');
  const format = useEntityFormat();
  const { t } = format;
  const {
    entities: contexts,
    hasMore,
    isLoadingMore,
    links,
    loadMore,
    loadMoreError,
    total,
  } = useEntityDataContext();

  // With pages still unloaded, a keyword also asks the server so older contexts can be found.
  // Clearing the keyword drops the search at once, so 「加载更早的情境」 pages the full list.
  const needle = keyword.trim();
  const debouncedNeedle = useDebounce(needle, { wait: 400 });
  const remoteMatches = useRemoteContextSearch(
    hasMore && needle ? debouncedNeedle || undefined : undefined,
  );
  const { select, selectedId } = useSelection();

  const groups = useMemo(() => {
    // Server hits stay in even when the match is in a field the list does not hold.
    const visible = searchMatches(
      contexts,
      needle,
      debouncedNeedle === needle ? remoteMatches : undefined,
    )
      .map((entity) => ({
        entity,
        lastTouchedAt: lastTouchedOf(entity, links),
      }))
      .sort((a, b) => b.lastTouchedAt.localeCompare(a.lastTouchedAt));

    const live = visible.filter((item) => item.entity.status === 'active');
    return [
      ...CONTEXT_KINDS.map((kind) => ({
        items: live.filter((item) => item.entity.kind === kind),
        key: kind,
        label: format.kind(kind),
        muted: false,
      })),
      {
        items: visible.filter((item) => item.entity.status !== 'active'),
        key: 'quiet',
        label: t('entity.list.quiet'),
        muted: true,
      },
    ].filter((group) => group.items.length > 0);
  }, [contexts, debouncedNeedle, format, links, needle, remoteMatches, t]);

  return (
    <aside aria-label={t('entity.list.title')} {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.heading)}>
          <h1 {...stylex.props(styles.title)}>{t('entity.list.title')}</h1>
          <span {...stylex.props(styles.count)}>
            {hasMore
              ? t('entity.list.loadedOf', { loaded: contexts.length, total })
              : contexts.length}
          </span>
        </div>
        <SearchBar
          allowClear
          placeholder={t('entity.list.searchPlaceholder')}
          value={keyword}
          variant={'filled'}
          onInputChange={setKeyword}
        />
      </div>
      <div {...stylex.props(styles.scroll)}>
        {groups.length === 0 ? (
          <div {...stylex.props(styles.noMatch)}>
            <Empty
              description={t('entity.list.noMatch', { keyword: needle })}
              icon={SearchXIcon}
              action={
                <Button onClick={() => setKeyword('')}>{t('entity.list.clearSearch')}</Button>
              }
            />
          </div>
        ) : (
          groups.map((group) => (
            <section aria-label={group.label} key={group.key} {...stylex.props(styles.group)}>
              <div {...stylex.props(styles.groupLabel)}>
                <span {...stylex.props(styles.groupName)}>{group.label}</span>
                <span>{group.items.length}</span>
              </div>
              {group.items.map((item) => (
                <ListItem
                  active={item.entity.id === selectedId}
                  entity={item.entity}
                  key={item.entity.id}
                  lastTouchedAt={item.lastTouchedAt}
                  muted={group.muted}
                  onSelect={select}
                />
              ))}
            </section>
          ))
        )}
        {hasMore && !needle && (
          <Button
            block
            loading={isLoadingMore}
            type={'text'}
            {...stylex.props(styles.more)}
            onClick={loadMore}
          >
            {t(loadMoreError ? 'entity.list.loadMoreRetry' : 'entity.list.loadMore')}
          </Button>
        )}
      </div>
    </aside>
  );
});

EntityList.displayName = 'EntityList';

export default EntityList;
