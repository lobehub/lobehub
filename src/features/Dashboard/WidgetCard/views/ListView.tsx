'use client';

import type { WidgetListOutput } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatWidgetValue } from '../../utils/format';

const styles = createStaticStyles(({ css }) => ({
  link: css`
    color: inherit;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  row: css`
    padding-block: 6px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
}));

interface ListViewProps {
  /** Rows to show before the "+N more" note; unlimited when omitted. */
  limit?: number;
  output: WidgetListOutput;
}

const ListView = memo<ListViewProps>(({ output, limit }) => {
  const { t } = useTranslation('dashboard');
  // Normalize once: an older server may send a list output without `items`.
  const allItems = output.items ?? [];
  const items = limit ? allItems.slice(0, limit) : allItems;
  const hidden = allItems.length - items.length;

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
        <Flexbox horizontal align={'center'} className={styles.row} gap={8} key={index}>
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Text ellipsis weight={500}>
              {item.url ? (
                <a className={styles.link} href={item.url} rel={'noreferrer'} target={'_blank'}>
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
      {hidden > 0 && (
        <Text fontSize={12} style={{ paddingTop: 6 }} type={'secondary'}>
          {t('widget.view.more', { count: hidden })}
        </Text>
      )}
    </Flexbox>
  );
});

ListView.displayName = 'DashboardListView';

export default ListView;
