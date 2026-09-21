'use client';

import type { MemoryDumpNode, MemoryDumpProcess } from '@lobechat/electron-client-ipc';
import { cx } from 'antd-style';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, memo, useState } from 'react';

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
        className={cx(styles.row, styles.mono, hasChildren && styles.rowClickable)}
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
          <span className={depth === 0 ? undefined : styles.muted}>{node.name}</span>
        </span>
        <span style={{ textAlign: 'end' }}>{formatCompactSize(node.sizeBytes)}</span>
        <span className={styles.bar} title={`${percent.toFixed(1)}% of tracked`}>
          <span className={styles.barFill} style={{ width: `${Math.min(100, percent)}%` }} />
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
      <div className={cx(styles.row, styles.mono)}>
        <span>
          {process.name} <span className={styles.muted}>pid {process.pid}</span>
        </span>
        <span style={{ textAlign: 'end' }}>{formatCompactSize(total)}</span>
        <span className={styles.muted}>
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
        <div className={cx(styles.caption, styles.mono)}>
          {counts.map((key) => `${key} ${process.objectCounts[key].toLocaleString()}`).join(' · ')}
        </div>
      )}
    </Fragment>
  );
});

DumpTree.displayName = 'DevMemoryDumpTree';

export default DumpTree;
