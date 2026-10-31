'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect, useRef } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import type { ApiEntry } from './useDevtoolsEntries';

const styles = stylex.create({
  column: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    width: '240px',
    height: '100%',
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  dot: {
    flexShrink: 0,
    width: '5px',
    height: '5px',
    borderRadius: '999px',
    backgroundColor: cssVar.colorTextQuaternary,
    backgroundImage: 'none',
  },
  dotActive: { backgroundColor: cssVar.colorPrimary, backgroundImage: 'none' },
  item: {
    cursor: 'pointer',
    overflow: 'hidden',
    flexShrink: 0,
    gap: '8px',
    alignItems: 'center',
    height: '30px',
    paddingInline: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    transition: 'background 0.15s,\n      color 0.15s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  itemActive: {
    color: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  labelHead: {
    overflow: 'hidden',
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    color: cssVar.colorTextQuaternary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  labelRow: {
    overflow: 'hidden',
    display: 'flex',
    flex: '1',
    alignItems: 'baseline',
    minWidth: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '13px',
  },
  labelTail: { flexShrink: 0, whiteSpace: 'nowrap' },
  list: { overflow: 'auto', flex: '1', gap: '2px', minHeight: '0', paddingBlock: '4px' },
});

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
    <aside {...stylex.props(styles.column)}>
      <div {...stylex.props(devDockPanelStyles.paneHeader)}>
        <Text fontSize={12} type={'secondary'} weight={600}>
          APIs · {apis.length}
        </Text>
      </div>
      <Flexbox className={stylex.props(styles.list).className} ref={listRef}>
        {apis.map((api) => {
          const active = api.apiName === activeApiName;
          const { head, tail } = splitName(api.apiName);
          return (
            <Flexbox
              horizontal
              className={stylex.props(styles.item, active && styles.itemActive).className}
              data-api={api.apiName}
              key={api.apiName}
              title={api.apiName}
              onClick={() => onSelect(api.apiName)}
            >
              <span {...stylex.props(styles.dot, api.render && styles.dotActive)} />
              <span {...stylex.props(styles.labelRow)}>
                {head && <span {...stylex.props(styles.labelHead)}>{head}</span>}
                <span {...stylex.props(styles.labelTail)}>{tail}</span>
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
