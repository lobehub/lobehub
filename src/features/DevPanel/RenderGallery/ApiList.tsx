'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useEffect, useRef } from 'react';

import type { ApiEntry } from './useDevtoolsEntries';

const styles = createStaticStyles(({ css, cssVar }) => ({
  column: css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;

    width: 220px;
    height: 100%;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  dot: css`
    flex-shrink: 0;

    width: 6px;
    height: 6px;
    border-radius: 999px;

    background: ${cssVar.colorTextQuaternary};
  `,
  dotActive: css`
    background: ${cssVar.colorPrimary};
  `,
  header: css`
    flex-shrink: 0;
    padding-block: 16px 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  item: css`
    cursor: pointer;

    overflow: hidden;
    gap: 8px;
    align-items: center;

    padding-block: 7px;
    padding-inline: 10px;
    border-radius: 8px;

    color: ${cssVar.colorTextSecondary};

    transition:
      background 0.15s,
      color 0.15s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  itemActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  label: css`
    overflow: hidden;
    flex: 1;

    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  list: css`
    overflow: auto;
    flex: 1;
    gap: 2px;

    padding-block: 8px;
    padding-inline: 8px;
  `,
}));

interface ApiListProps {
  activeApiName?: string;
  apis: ApiEntry[];
  onSelect: (apiName: string) => void;
}

/**
 * Middle column for the render gallery: a jump-list of the current toolset's
 * APIs. Clicking scrolls the matching `ToolPreview` card into view (the card
 * carries `id={toApiAnchor(apiName)}`); the active item is driven by the
 * scrollspy in `ToolPage`. The leading dot lights up when the API ships a
 * Render — the gallery's primary subject — so a render-less API reads as muted.
 */
const ApiList = memo<ApiListProps>(({ apis, activeApiName, onSelect }) => {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the highlighted item visible as the scrollspy walks down the right
  // pane — otherwise the list stays pinned at the top and you lose your place.
  useEffect(() => {
    if (!activeApiName) return;
    const el = listRef.current?.querySelector(`[data-api="${CSS.escape(activeApiName)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeApiName]);

  return (
    <aside className={styles.column}>
      <div className={styles.header}>
        <Text fontSize={12} type={'secondary'} weight={600}>
          APIs · {apis.length}
        </Text>
      </div>
      <Flexbox className={styles.list} ref={listRef}>
        {apis.map((api) => {
          const active = api.apiName === activeApiName;
          return (
            <Flexbox
              horizontal
              className={cx(styles.item, active && styles.itemActive)}
              data-api={api.apiName}
              key={api.apiName}
              onClick={() => onSelect(api.apiName)}
            >
              <span className={cx(styles.dot, api.render && styles.dotActive)} />
              <span className={styles.label}>{api.apiName}</span>
            </Flexbox>
          );
        })}
      </Flexbox>
    </aside>
  );
});

ApiList.displayName = 'DevtoolsApiList';

export default ApiList;
