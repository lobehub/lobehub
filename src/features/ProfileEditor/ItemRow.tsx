'use client';

import { cssVar, Flexbox, Tag, Text } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';

import { shouldActivateRow } from './rowKeys';

interface ItemRowProps {
  /** Controls at the end of the row: remove, switch, … */
  actions?: ReactNode;
  /** Shows the name as a problem, e.g. a tool that is no longer installed. */
  danger?: boolean;
  description?: string;
  /** The icon, shown on a small tile so every row lines up whatever the icon looks like. */
  icon: ReactNode;
  /** Something small between the name and the actions, such as who authorized it. */
  meta?: ReactNode;
  /** Opens the item's details when the row is clicked. */
  onClick?: () => void;
  /** What kind of thing this is, as a quiet label at the end. */
  tag?: string;
  title: string;
}

/**
 * One tool, skill, knowledge base or file as a row: an icon tile, the name with a line about
 * it, its kind, and the actions. The same row everywhere a list of these appears.
 */
const ItemRow = memo<ItemRowProps>(
  ({ actions, danger, description, icon, meta, onClick, tag, title }) => (
    <Flexbox
      horizontal
      align={'center'}
      gap={12}
      role={onClick ? 'button' : undefined}
      style={onClick ? { cursor: 'pointer' } : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (!shouldActivateRow(event)) return;
              event.preventDefault();
              onClick();
            }
          : undefined
      }
    >
      <Flexbox
        align={'center'}
        flex={'none'}
        justify={'center'}
        style={{
          background: cssVar.colorFillTertiary,
          borderRadius: 8,
          height: 32,
          width: 32,
        }}
      >
        {icon}
      </Flexbox>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis style={{ fontWeight: 500 }} type={danger ? 'danger' : undefined}>
          {title}
        </Text>
        {description ? (
          <Text ellipsis fontSize={12} type={'secondary'}>
            {description}
          </Text>
        ) : null}
      </Flexbox>
      {meta}
      {tag ? <Tag style={{ flex: 'none', margin: 0 }}>{tag}</Tag> : null}
      {/* Controls act on the item; they must not also open its details. */}
      {actions ? (
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          {actions}
        </Flexbox>
      ) : null}
    </Flexbox>
  ),
);

ItemRow.displayName = 'ItemRow';

export default ItemRow;
