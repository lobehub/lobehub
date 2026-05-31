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

    width: 240px;
    height: 100%;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  dot: css`
    flex-shrink: 0;

    width: 5px;
    height: 5px;
    border-radius: 999px;

    background: ${cssVar.colorTextQuaternary};
  `,
  dotActive: css`
    background: ${cssVar.colorPrimary};
  `,
  header: css`
    flex-shrink: 0;
    padding-block: 14px 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  item: css`
    cursor: pointer;

    overflow: hidden;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;

    height: 30px;
    padding-inline: 10px;
    border-radius: 6px;

    color: ${cssVar.colorTextSecondary};

    transition:
      background 0.15s,
      color 0.15s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  itemActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  /** Namespace prefix of an mcp__ name — muted, and the part that elides. */
  labelHead: css`
    overflow: hidden;
    flex: 0 1 auto;

    color: ${cssVar.colorTextQuaternary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  labelRow: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    align-items: baseline;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
  `,
  /** Trailing action segment — always kept visible. */
  labelTail: css`
    flex-shrink: 0;
    white-space: nowrap;
  `,
  list: css`
    overflow: auto;
    flex: 1;
    gap: 2px;

    min-height: 0;
    padding-block: 8px;
    padding-inline: 8px;
  `,
}));

/**
 * Split a name at its last `__` so the long `mcp__<server>__` namespace can
 * elide from the middle (`mcp__claude_ai_Li…get_diff`) — keeping both the
 * `mcp` signal up front and the distinguishing action at the end, instead of
 * truncating one or the other away. Non-namespaced names are all tail.
 */
const splitName = (name: string): { head: string; tail: string } => {
  const cut = name.lastIndexOf('__');
  if (cut === -1) return { head: '', tail: name };
  return { head: name.slice(0, cut + 2), tail: name.slice(cut + 2) };
};

interface ApiListProps {
  activeApiName?: string;
  apis: ApiEntry[];
  onSelect: (apiName: string) => void;
}

/**
 * Middle column for the render gallery: a dense jump-list of the current
 * toolset's APIs. Clicking scrolls the matching `ToolPreview` card into view
 * and pins a URL hash (`#api-<name>`) so a specific render is deep-linkable;
 * the active item is driven by the scrollspy in `ToolPage`. The leading dot
 * lights up when the API ships a Render.
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
          const { head, tail } = splitName(api.apiName);
          return (
            <Flexbox
              horizontal
              className={cx(styles.item, active && styles.itemActive)}
              data-api={api.apiName}
              key={api.apiName}
              title={api.apiName}
              onClick={() => onSelect(api.apiName)}
            >
              <span className={cx(styles.dot, api.render && styles.dotActive)} />
              <span className={styles.labelRow}>
                {head && <span className={styles.labelHead}>{head}</span>}
                <span className={styles.labelTail}>{tail}</span>
              </span>
            </Flexbox>
          );
        })}
      </Flexbox>
    </aside>
  );
});

ApiList.displayName = 'DevtoolsApiList';

export default ApiList;
