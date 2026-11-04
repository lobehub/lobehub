import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import type { ReviewView } from '../api';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const styles = stylex.create({
  block: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 10,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
  cell: {
    borderBlockStartColor: cssVar.colorFillSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    paddingBlock: 8,
    paddingInline: 14,
    verticalAlign: 'top',
  },
  code: {
    color: cssVar.colorText,
    fontFamily: mono,
    fontSize: 12.5,
    lineHeight: 1.7,
    margin: 0,
    overflowX: 'auto',
    padding: 14,
    whiteSpace: 'pre',
  },
  differs: { backgroundColor: cssVar.colorErrorBg },
  empty: { color: cssVar.colorTextQuaternary },
  group: {
    backgroundColor: cssVar.colorFillQuaternary,
    color: cssVar.colorTextSecondary,
    fontFamily: mono,
    fontSize: 12.5,
    fontWeight: 600,
    paddingBlock: 8,
    paddingInline: 14,
  },
  head: {
    backgroundColor: cssVar.colorFillQuaternary,
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    fontWeight: 500,
    paddingBlock: 10,
    paddingInline: 14,
    textAlign: 'start',
  },
  heading: { fontSize: 15, fontWeight: 600, marginBlockEnd: 4, marginBlockStart: 32 },
  label: { color: cssVar.colorTextSecondary, fontFamily: mono, fontSize: 12.5 },
  line: { display: 'block' },
  no: { color: cssVar.colorError, fontSize: 12, whiteSpace: 'nowrap' },
  ok: { color: cssVar.colorSuccess, fontSize: 12, whiteSpace: 'nowrap' },
  pane: { minWidth: 0 },
  paneHead: {
    borderBlockEndColor: cssVar.colorFillSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    paddingBlock: 8,
    paddingInline: 14,
  },
  panes: { display: 'grid', gridTemplateColumns: '1fr 1fr' },
  paneSplit: {
    borderInlineStartColor: cssVar.colorFillSecondary,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: 1,
  },
  sources: { display: 'grid', rowGap: 14 },
  sub: { color: cssVar.colorTextTertiary, fontSize: 12.5, marginBlockEnd: 12 },
  swatch: (color: string) => ({
    backgroundColor: color,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    borderRadius: 3,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'inline-block',
    height: 10,
    marginInlineEnd: 6,
    verticalAlign: '-1px',
    width: 10,
  }),
  table: { borderCollapse: 'collapse', fontSize: 13, width: '100%' },
  value: { color: cssVar.colorText, fontFamily: mono, fontSize: 12.5 },
});

const COLOR_TOKEN = /:\s*(color[A-Z]\w*)$/;

const tokenVar = (name: string) =>
  `var(--lobe-${name.replaceAll(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)})`;

const Lines = ({ label, lines }: { label: string; lines: string[] }) =>
  lines.length ? (
    <>
      {lines.map((line) => {
        const color = COLOR_TOKEN.exec(line)?.[1];
        return (
          <span key={line} {...stylex.props(styles.line)}>
            {color && <i {...stylex.props(styles.swatch(tokenVar(color)))} />}
            {line.startsWith(`${label.split(' ').pop()}: `)
              ? line.slice(line.indexOf(': ') + 2)
              : line}
          </span>
        );
      })}
    </>
  ) : (
    <span {...stylex.props(styles.empty)}>没有写</span>
  );

const DeclarationTable = ({ blocks }: { blocks: ReviewView['styles']['blocks'] }) => (
  <div {...stylex.props(styles.block)}>
    <table {...stylex.props(styles.table)}>
      <thead>
        <tr>
          <th {...stylex.props(styles.head)}>属性</th>
          <th {...stylex.props(styles.head)}>改之前</th>
          <th {...stylex.props(styles.head)}>改之后</th>
          <th {...stylex.props(styles.head)}>渲染结果</th>
        </tr>
      </thead>
      {blocks.map((block) => (
        <tbody key={block.slot}>
          <tr>
            <td colSpan={4} {...stylex.props(styles.group)}>
              {block.slot}
            </td>
          </tr>
          {block.rows.map((row) => (
            <tr key={row.label} {...stylex.props(row.differs && styles.differs)}>
              <td {...stylex.props(styles.cell, styles.label)}>{row.label}</td>
              <td {...stylex.props(styles.cell, styles.value)}>
                <Lines label={row.label} lines={row.before} />
              </td>
              <td {...stylex.props(styles.cell, styles.value)}>
                <Lines label={row.label} lines={row.after} />
              </td>
              <td {...stylex.props(styles.cell)}>
                <span {...stylex.props(row.differs ? styles.no : styles.ok)}>
                  {row.differs ? '不一样' : '一致'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  </div>
);

const SourcePane = ({
  children,
  label,
  split,
}: {
  children: string;
  label: string;
  split?: boolean;
}) => (
  <div {...stylex.props(styles.pane, split && styles.paneSplit)}>
    <div {...stylex.props(styles.paneHead)}>{label}</div>
    <pre {...stylex.props(styles.code)}>{children}</pre>
  </div>
);

const SourceCompare = ({ styles: data }: { styles: ReviewView['styles'] }) => {
  const slots = [
    ...new Set([...Object.keys(data.source.base ?? {}), ...Object.keys(data.source.head ?? {})]),
  ].sort();
  const usage = (side: 'base' | 'head') =>
    (data.usage[side] ?? ['（这一侧没有这个元素）']).join('\n');
  return (
    <div {...stylex.props(styles.sources)}>
      <div {...stylex.props(styles.block)}>
        <div {...stylex.props(styles.group)}>JSX 用法</div>
        <div {...stylex.props(styles.panes)}>
          <SourcePane label="改之前">{usage('base')}</SourcePane>
          <SourcePane split label="改之后">
            {usage('head')}
          </SourcePane>
        </div>
      </div>
      {slots.map((slot) => (
        <div key={slot} {...stylex.props(styles.block)}>
          <div {...stylex.props(styles.group)}>{slot}</div>
          <div {...stylex.props(styles.panes)}>
            <SourcePane label="改之前">{data.source.base?.[slot] ?? '（没有）'}</SourcePane>
            <SourcePane split label="改之后">
              {data.source.head?.[slot] ?? '（没有）'}
            </SourcePane>
          </div>
        </div>
      ))}
    </div>
  );
};

export const StyleDetails = ({ item }: { item: ReviewView }) => (
  <>
    {item.styles.blocks.length > 0 && (
      <section>
        <h2 {...stylex.props(styles.heading)}>样式对照</h2>
        <div {...stylex.props(styles.sub)}>
          两边都换成 CSS 属性名，按样式块对齐。渲染结果那一列来自真实截图比对，不是看代码猜的。
        </div>
        <DeclarationTable blocks={item.styles.blocks} />
      </section>
    )}
    {Object.keys(item.styles.usage).length > 0 && (
      <section>
        <h2 {...stylex.props(styles.heading)}>源码对照</h2>
        <div {...stylex.props(styles.sub)}>原文不截断，调试用。</div>
        <SourceCompare styles={item.styles} />
      </section>
    )}
  </>
);
