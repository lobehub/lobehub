import { Accordion, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import type { ReviewView } from '../api';

const styles = stylex.create({
  block: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
  cell: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    paddingBlock: 8,
    paddingInline: 12,
    verticalAlign: 'top',
  },
  code: {
    color: cssVar.colorText,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    lineHeight: 1.7,
    margin: 0,
    overflowX: 'auto',
    padding: 12,
    whiteSpace: 'pre',
  },
  differs: { backgroundColor: cssVar.colorErrorBg },
  group: {
    backgroundColor: cssVar.colorFillQuaternary,
    color: cssVar.colorTextSecondary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    fontWeight: 600,
    paddingBlock: 8,
    paddingInline: 12,
  },
  head: {
    backgroundColor: cssVar.colorFillQuaternary,
    color: cssVar.colorTextTertiary,
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    paddingBlock: 8,
    paddingInline: 12,
    textAlign: 'start',
  },
  line: { display: 'block' },
  mono: { color: cssVar.colorText, fontFamily: cssVar.fontFamilyCode, fontSize: cssVar.fontSizeSM },
  movedHead: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'dashed',
    borderBlockStartWidth: 1,
    color: cssVar.colorTextSecondary,
    fontSize: cssVar.fontSizeSM,
    paddingBlock: 8,
    paddingInline: 12,
  },
  movedNote: { display: 'block', marginBlockStart: 4 },
  pane: { minWidth: 0 },
  paneHead: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    color: cssVar.colorTextTertiary,
    fontSize: cssVar.fontSizeSM,
    paddingBlock: 8,
    paddingInline: 12,
  },
  panes: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  paneSplit: {
    borderInlineStartColor: cssVar.colorBorderSecondary,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: 1,
  },
  standIn: { fontFamily: cssVar.fontFamily, fontWeight: 400, marginInlineStart: 12 },
  swatch: (color: string) => ({
    backgroundColor: color,
    borderColor: cssVar.colorBorder,
    borderRadius: 3,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'inline-block',
    height: 10,
    marginInlineEnd: 6,
    verticalAlign: '-1px',
    width: 10,
  }),
  table: { borderCollapse: 'collapse', fontSize: cssVar.fontSizeSM, width: '100%' },
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
    <Text fontSize={12} type="secondary">
      没有写
    </Text>
  );

const RESULT = {
  differs: { text: '不一样', type: 'danger' },
  oneSided: { text: '只写在一边，渲染一致', type: 'warning' },
  same: { text: '一致', type: 'success' },
} as const;

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
              {block.standIn && (
                <Text as="span" fontSize={12} type="warning" {...stylex.props(styles.standIn)}>
                  按替身渲染：没有加载 {block.standIn}{' '}
                  自带的样式，这一块的「一致」只说明我们写的样式没变
                </Text>
              )}
            </td>
          </tr>
          {block.rows.map((row) => {
            const result = RESULT[row.differs ? 'differs' : row.oneSided ? 'oneSided' : 'same'];
            return (
              <tr key={row.label} {...stylex.props(row.differs && styles.differs)}>
                <td {...stylex.props(styles.cell, styles.mono)}>{row.label}</td>
                <td {...stylex.props(styles.cell, styles.mono)}>
                  <Lines label={row.label} lines={row.before} />
                </td>
                <td {...stylex.props(styles.cell, styles.mono)}>
                  <Lines label={row.label} lines={row.after} />
                  {row.movedTo?.map((where) => (
                    <Text
                      as="span"
                      fontSize={12}
                      key={where}
                      type="secondary"
                      {...stylex.props(styles.movedNote)}
                    >
                      写在子元素 {where}
                    </Text>
                  ))}
                </td>
                <td {...stylex.props(styles.cell)}>
                  <Text fontSize={12} type={result.type}>
                    {result.text}
                  </Text>
                </td>
              </tr>
            );
          })}
        </tbody>
      ))}
    </table>
  </div>
);

type MovedSlots = ReviewView['styles']['moved'][string];

const SourcePane = ({
  children,
  label,
  moved = [],
  split,
}: {
  children: string;
  label: string;
  moved?: MovedSlots;
  split?: boolean;
}) => (
  <div {...stylex.props(styles.pane, split && styles.paneSplit)}>
    <div {...stylex.props(styles.paneHead)}>{label}</div>
    <pre {...stylex.props(styles.code)}>{children}</pre>
    {moved.map((group) => (
      <div key={group.slot}>
        <div {...stylex.props(styles.movedHead)}>
          改之前 {group.selectors.join('、')} 的规则，现在写在子元素 &lt;
          {group.tags.join('> <')}&gt; 的 {group.slot} 上
        </div>
        <pre {...stylex.props(styles.code)}>{group.text}</pre>
      </div>
    ))}
  </div>
);

const SourceCompare = ({ styles: data }: { styles: ReviewView['styles'] }) => {
  const slots = [
    ...new Set([...Object.keys(data.source.base ?? {}), ...Object.keys(data.source.head ?? {})]),
  ].sort();
  const usage = (side: 'base' | 'head') =>
    (data.usage[side] ?? ['（这一侧没有这个元素）']).join('\n');
  const label = (side: 'base' | 'head', text: string) =>
    data.counterpart === side ? `${text}：同一位置的元素，没有样式类` : text;
  return (
    <Flexbox gap={12}>
      <div {...stylex.props(styles.block)}>
        <div {...stylex.props(styles.group)}>JSX 用法</div>
        <div {...stylex.props(styles.panes)}>
          <SourcePane label={label('base', '改之前')}>{usage('base')}</SourcePane>
          <SourcePane split label={label('head', '改之后')}>
            {usage('head')}
          </SourcePane>
        </div>
      </div>
      {slots.map((slot) => (
        <div key={slot} {...stylex.props(styles.block)}>
          <div {...stylex.props(styles.group)}>{slot}</div>
          <div {...stylex.props(styles.panes)}>
            <SourcePane label="改之前">{data.source.base?.[slot] ?? '（没有）'}</SourcePane>
            <SourcePane split label="改之后" moved={data.moved[slot]}>
              {data.source.head?.[slot] ?? '（没有）'}
            </SourcePane>
          </div>
        </div>
      ))}
    </Flexbox>
  );
};

export const StyleDetails = ({ item }: { item: ReviewView }) => {
  const items = [
    item.styles.blocks.length > 0 && {
      children: (
        <Flexbox gap={8}>
          <Text fontSize={12} type="secondary">
            两边都换成 CSS 属性名，按样式块对齐。渲染结果来自截图比对，不是看代码猜的。
          </Text>
          <DeclarationTable blocks={item.styles.blocks} />
        </Flexbox>
      ),
      key: 'declarations',
      title: '样式对照',
    },
    Object.keys(item.styles.usage).length > 0 && {
      children: <SourceCompare styles={item.styles} />,
      key: 'source',
      title: '源码对照（原文不截断，调试用）',
    },
  ].filter((entry) => entry !== false);
  if (!items.length) return null;
  return <Accordion defaultValue={['declarations']} gap={8} items={items} variant="borderless" />;
};
