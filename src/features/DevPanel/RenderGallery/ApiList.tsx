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

    padding-block: 6px;
    padding-inline: 10px;
    border-radius: 6px;

    color: ${cssVar.colorTextSecondary};

    transition:
      background 0.15s,
      color 0.15s,
      box-shadow 0.15s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  itemActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
    box-shadow: inset 2px 0 0 ${cssVar.colorPrimary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  label: css`
    overflow: hidden;
    flex: 1;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  list: css`
    overflow: auto;
    flex: 1;
    gap: 1px;

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
 * MCP tools carry a long `mcp__<server>__<action>` identifier that truncates to
 * an indistinguishable `mcp__claude_ai_Linear__…` in a narrow column. Show just
 * the trailing action so siblings are scannable; the full id stays in the
 * `title` tooltip and the preview card header.
 */
const shortApiName = (name: string) =>
  name.startsWith('mcp__') ? (name.split('__').at(-1) ?? name) : name;

/**
 * Middle column for the render gallery: a jump-list of the current toolset's
 * APIs. Clicking scrolls the matching `ToolPreview` card into view and pins a
 * URL hash (`#api-<name>`) so a specific render is deep-linkable; the active
 * item is driven by the scrollspy in `ToolPage`. The leading dot lights up
 * when the API ships a Render — the gallery's primary subject — so a
 * render-less API reads as muted. Long MCP names truncate with a `title`
 * tooltip carrying the full identifier.
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
              title={api.apiName}
              onClick={() => onSelect(api.apiName)}
            >
              <span className={cx(styles.dot, api.render && styles.dotActive)} />
              <span className={styles.label}>{shortApiName(api.apiName)}</span>
            </Flexbox>
          );
        })}
      </Flexbox>
    </aside>
  );
});

ApiList.displayName = 'DevtoolsApiList';

export default ApiList;
