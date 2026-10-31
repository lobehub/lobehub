'use client';

import type { MemoryDumpNode, MemoryDumpProcess } from '@lobechat/electron-client-ipc';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, memo, useState } from 'react';

import { sx } from '@/styles/sx';

import { formatCompactSize } from '../memoryFormat';
import { styles } from './styles';

const OBJECT_COUNT_KEYS = [
  'Node',
  'LayoutObject',
  'JSEventListener',
  'ArrayBufferContents',
  'Document',
  'Frame',
  'Resource',
];

const NodeRow = memo<{
  depth: number;
  expanded: Set<string>;
  node: MemoryDumpNode;
  path: string;
  toggle: (path: string) => void;
  total: number;
}>(({ depth, expanded, node, path, toggle, total }) => {
  const open = expanded.has(path);
  const hasChildren = node.children.length > 0;
  const percent = total > 0 ? (node.sizeBytes / total) * 100 : 0;

  return (
    <Fragment>
      <div
        {...stylex.props(styles.row, styles.mono, hasChildren && styles.rowClickable)}
        onClick={hasChildren ? () => toggle(path) : undefined}
      >
        <span
          style={{ alignItems: 'center', display: 'flex', gap: 4, paddingInlineStart: depth * 14 }}
        >
          {hasChildren ? (
            open ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )
          ) : (
            <span style={{ width: 11 }} />
          )}
          <span {...stylex.props(depth === 0 ? undefined : styles.muted)}>{node.name}</span>
        </span>
        <span style={{ textAlign: 'end' }}>{formatCompactSize(node.sizeBytes)}</span>
        <span {...stylex.props(styles.bar)} title={`${percent.toFixed(1)}% of tracked`}>
          <span {...sx([styles.barFill], undefined, { width: `${Math.min(100, percent)}%` })} />
        </span>
      </div>
      {open &&
        node.children.map((child) => (
          <NodeRow
            depth={depth + 1}
            expanded={expanded}
            key={child.name}
            node={child}
            path={`${path}/${child.name}`}
            toggle={toggle}
            total={total}
          />
        ))}
    </Fragment>
  );
});

NodeRow.displayName = 'DevMemoryDumpNodeRow';

const DumpTree = memo<{ process: MemoryDumpProcess }>(({ process }) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const total = process.allocators.reduce((sum, node) => sum + node.sizeBytes, 0);
  const counts = OBJECT_COUNT_KEYS.filter((key) => process.objectCounts[key] !== undefined);

  return (
    <Fragment>
      <div {...stylex.props(styles.row, styles.mono)}>
        <span>
          {process.name} <span {...stylex.props(styles.muted)}>pid {process.pid}</span>
        </span>
        <span style={{ textAlign: 'end' }}>{formatCompactSize(total)}</span>
        <span {...stylex.props(styles.muted)}>
          {process.privateFootprintBytes === null
            ? 'tracked'
            : `footprint ${formatCompactSize(process.privateFootprintBytes)}`}
        </span>
      </div>
      {process.allocators.map((node) => (
        <NodeRow
          depth={0}
          expanded={expanded}
          key={node.name}
          node={node}
          path={`${process.pid}/${node.name}`}
          toggle={toggle}
          total={total}
        />
      ))}
      {counts.length > 0 && (
        <div {...stylex.props(styles.caption, styles.mono)}>
          {counts.map((key) => `${key} ${process.objectCounts[key].toLocaleString()}`).join(' · ')}
        </div>
      )}
    </Fragment>
  );
});

DumpTree.displayName = 'DevMemoryDumpTree';

export default DumpTree;
