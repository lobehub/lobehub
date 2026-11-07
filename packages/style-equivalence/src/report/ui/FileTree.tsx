import { Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { buildTree, type FileStatus, type ReportCase, type UnpairedEntry } from '../data';
import { CATEGORY_LABELS } from '../labels';
import { hrefOf } from '../route';

const styles = stylex.create({
  directory: {
    color: cssVar.colorTextTertiary,
    fontSize: cssVar.fontSizeSM,
    paddingBlockEnd: 4,
    paddingBlockStart: 12,
    paddingInline: 12,
    wordBreak: 'break-all',
  },
  dot: { borderRadius: '50%', flex: 'none', height: 8, width: 8 },
  file: {
    alignItems: 'center',
    backgroundColor: { ':hover': cssVar.colorFillTertiary, 'default': 'transparent' },
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    columnGap: 8,
    display: 'grid',
    fontSize: cssVar.fontSize,
    gridTemplateColumns: '8px minmax(0, 1fr) auto',
    paddingBlock: 6,
    paddingInline: 12,
    textDecorationLine: 'none',
  },
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  root: {
    backgroundColor: { ':hover': cssVar.colorFillTertiary, 'default': 'transparent' },
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorText,
    display: 'block',
    fontSize: cssVar.fontSize,
    fontWeight: 500,
    paddingBlock: 6,
    paddingInline: 12,
    textDecorationLine: 'none',
  },
  selected: {
    backgroundColor: { ':hover': cssVar.colorFillSecondary, 'default': cssVar.colorFillSecondary },
    color: cssVar.colorText,
    fontWeight: 500,
  },
  tree: { padding: 8 },
});

const dots = stylex.create({
  'blocking': { backgroundColor: cssVar.colorTextQuaternary },
  'difference': { backgroundColor: cssVar.colorError },
  'equal': { backgroundColor: cssVar.colorSuccess },
  'needs-signoff': { backgroundColor: cssVar.colorWarning },
});

export const StatusDot = ({ status }: { status: FileStatus }) => (
  <span
    aria-label={CATEGORY_LABELS[status]}
    role="img"
    {...stylex.props(styles.dot, dots[status])}
  />
);

export const FileTree = ({
  atOverview,
  cases,
  selected,
  unpaired,
}: {
  atOverview: boolean;
  cases: ReportCase[];
  selected: string | undefined;
  unpaired: UnpairedEntry[];
}) => (
  <nav {...stylex.props(styles.tree)}>
    <a
      aria-current={atOverview ? 'page' : undefined}
      href={hrefOf({ kind: 'overview' })}
      {...stylex.props(styles.root, atOverview && styles.selected)}
    >
      全部文件
    </a>
    {buildTree(cases, unpaired).map(({ directory, files }) => (
      <div key={directory}>
        <div {...stylex.props(styles.directory)}>{directory || '.'}</div>
        {files.map((file) => (
          <a
            aria-current={selected === file.file ? 'page' : undefined}
            data-status={file.status}
            href={hrefOf({ file: file.file, kind: 'file' })}
            key={file.file}
            title={file.file}
            {...stylex.props(styles.file, selected === file.file && styles.selected)}
          >
            <StatusDot status={file.status} />
            <span {...stylex.props(styles.name)}>{file.name}</span>
            <Text fontSize={12} type="secondary">
              {file.open ? `${file.open} / ${file.total}` : file.total}
            </Text>
          </a>
        ))}
      </div>
    ))}
  </nav>
);
