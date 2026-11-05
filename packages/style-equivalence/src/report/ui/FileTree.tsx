import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { buildTree, type FileStatus, type ReportCase, type UnpairedEntry } from '../data';
import { hrefOf } from '../route';

const styles = stylex.create({
  count: { color: cssVar.colorTextTertiary, fontSize: 12 },
  directory: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    paddingBlock: 4,
    paddingInline: 16,
    wordBreak: 'break-all',
  },
  dot: { borderRadius: '50%', height: 8, width: 8 },
  file: {
    alignItems: 'center',
    color: { ':hover': cssVar.colorText, 'default': cssVar.colorTextSecondary },
    columnGap: 8,
    display: 'grid',
    fontSize: 13,
    gridTemplateColumns: '10px 1fr auto',
    paddingBlock: 5,
    paddingInlineEnd: 16,
    paddingInlineStart: 28,
    textDecorationLine: 'none',
  },
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  root: {
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: 6,
    color: cssVar.colorText,
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    marginBlockEnd: 6,
    marginInline: 8,
    paddingBlock: 6,
    paddingInline: 10,
    textDecorationLine: 'none',
  },
  selected: { backgroundColor: cssVar.colorFillTertiary, color: cssVar.colorText },
  tree: { overflowY: 'auto', paddingBlock: 12 },
});

const dots = stylex.create({
  'blocking': { backgroundColor: cssVar.colorTextSecondary },
  'difference': { backgroundColor: cssVar.colorError },
  'equal': { backgroundColor: cssVar.colorSuccess },
  'needs-signoff': { backgroundColor: cssVar.colorWarning },
});

export const StatusDot = ({ status }: { status: FileStatus }) => (
  <span {...stylex.props(styles.dot, dots[status])} />
);

export const FileTree = ({
  cases,
  selected,
  unpaired,
}: {
  cases: ReportCase[];
  selected: string | undefined;
  unpaired: UnpairedEntry[];
}) => (
  <nav {...stylex.props(styles.tree)}>
    <a href={hrefOf({ kind: 'overview' })} {...stylex.props(styles.root)}>
      全部文件 · 总览
    </a>
    {buildTree(cases, unpaired).map(({ directory, files }) => (
      <div key={directory}>
        <div {...stylex.props(styles.directory)}>{directory || '.'}</div>
        {files.map((file) => (
          <a
            data-status={file.status}
            href={hrefOf({ file: file.file, kind: 'file' })}
            key={file.file}
            title={file.file}
            {...stylex.props(styles.file, selected === file.file && styles.selected)}
          >
            <StatusDot status={file.status} />
            <span {...stylex.props(styles.name)}>{file.name}</span>
            <span {...stylex.props(styles.count)}>
              {file.open ? `${file.open} / ${file.total}` : file.total}
            </span>
          </a>
        ))}
      </div>
    ))}
  </nav>
);
