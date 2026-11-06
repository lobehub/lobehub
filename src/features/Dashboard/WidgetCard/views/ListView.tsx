'use client';

import type { WidgetListOutput } from '@lobechat/types';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatWidgetValue } from '../../utils/format';
import { useIncrementalRows } from './useIncrementalRows';

const styles = stylex.create({
  link: { color: { 'default': 'inherit', ':hover': cssVar.colorPrimary } },
  row: {
    paddingBlock: '6px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'solid', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

interface ListViewProps {
  /** Reveal rows in batches as the card is scrolled instead of mounting them all. */
  incremental?: boolean;
  /** Hard cap shown before the "+N more" note; unlimited when omitted. */
  limit?: number;
  output: WidgetListOutput;
}

const ListView = memo<ListViewProps>(({ output, limit, incremental }) => {
  const { t } = useTranslation('dashboard');
  // Normalize once: an older server may send a list output without `items`.
  const allItems = output.items ?? [];
  const capped = limit ? allItems.slice(0, limit) : allItems;
  const { count, hasMore, sentinelRef } = useIncrementalRows(capped.length, !!incremental);
  const items = capped.slice(0, count);
  const hidden = allItems.length - capped.length;

  if (allItems.length === 0) {
    return (
      <Text fontSize={12} type={'secondary'}>
        {t('widget.view.listEmpty')}
      </Text>
    );
  }

  return (
    <Flexbox>
      {items.map((item, index) => (
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.row).className}
          gap={8}
          key={index}
        >
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Text ellipsis weight={500}>
              {item.url ? (
                <a
                  {...stylex.props(styles.link)}
                  href={item.url}
                  rel={'noreferrer'}
                  target={'_blank'}
                >
                  {item.title}
                </a>
              ) : (
                item.title
              )}
            </Text>
            {(item.description || item.time) && (
              <Text ellipsis fontSize={12} type={'secondary'}>
                {[item.description, item.time && dayjs(item.time).fromNow()]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            )}
          </Flexbox>
          {item.status && <Tag size={'small'}>{item.status}</Tag>}
          {item.value !== undefined && (
            <Text style={{ fontVariantNumeric: 'tabular-nums' }} weight={500}>
              {formatWidgetValue(item.value)}
            </Text>
          )}
        </Flexbox>
      ))}
      {hasMore && <div key={count} ref={sentinelRef} style={{ flex: 'none', height: 1 }} />}
      {hidden > 0 && !hasMore && (
        <Text fontSize={12} style={{ paddingTop: 6 }} type={'secondary'}>
          {t('widget.view.more', { count: hidden })}
        </Text>
      )}
    </Flexbox>
  );
});

ListView.displayName = 'DashboardListView';

export default ListView;
