import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

import type { CaseDetail } from '../api';
import { type ConditionColumn } from '../data';
import { shorthandsIn } from '../declared';
import { flagLabel } from '../labels';
import { hrefOf } from '../route';
import { MatrixStrip } from './MatrixStrip';

const styles = stylex.create({
  code: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: 1,
    color: cssVar.colorText,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    lineHeight: 1.6,
    marginBlock: 0,
    overflowX: 'auto',
    paddingBlock: 8,
    paddingInline: 12,
    whiteSpace: 'pre',
  },
  heading: { fontSize: cssVar.fontSize, fontWeight: 600, marginBlockEnd: 8, marginBlockStart: 0 },
  label: { color: cssVar.colorTextTertiary, fontSize: cssVar.fontSizeSM, marginBlockEnd: 4 },
  list: {
    display: 'flex',
    flexDirection: 'column',
    marginBlock: 0,
    paddingInlineStart: 18,
    rowGap: 4,
  },
  note: { color: cssVar.colorTextSecondary, fontSize: cssVar.fontSizeSM, lineHeight: 1.7 },
  number: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillSecondary,
    borderRadius: '50%',
    color: cssVar.colorText,
    display: 'flex',
    fontSize: cssVar.fontSizeSM,
    fontWeight: 600,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  step: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    columnGap: 12,
    display: 'grid',
    gridTemplateColumns: '20px minmax(0, 1fr)',
    paddingBlock: 16,
  },
  strip: { overflowX: 'auto', paddingBlockEnd: 4 },
  two: { columnGap: 12, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
});

const CORPUS_FOR: Record<string, string> = { background: 'background-reset', border: 'border' };

const Step = ({
  children,
  index,
  title,
}: {
  children: ReactNode;
  index: number;
  title: string;
}) => (
  <div {...stylex.props(styles.step)}>
    <div {...stylex.props(styles.number)}>{index}</div>
    <div>
      <h3 {...stylex.props(styles.heading)}>{title}</h3>
      {children}
    </div>
  </div>
);

const Declarations = ({ texts }: { texts?: Record<string, string> }) =>
  texts && Object.keys(texts).length ? (
    <pre {...stylex.props(styles.code)}>{Object.values(texts).join('\n\n')}</pre>
  ) : (
    <div {...stylex.props(styles.note)}>这一侧没有这个元素。</div>
  );

const chainText = (elements?: Array<{ tag: string }>) =>
  elements?.map((element) => `<${element.tag}>`).join(' › ') ?? '--';

export const EvidenceChain = ({
  columns,
  detail,
}: {
  columns: ConditionColumn[];
  detail: CaseDetail;
}) => {
  const record = detail.case;
  const evidence = detail.evidence;
  const flags = [...(record?.plan.flags ?? []), ...(record?.result.gaps ?? [])];
  const slots = new Set([
    ...(evidence?.elements.base ?? []).flatMap((element) => element.slots),
    ...(evidence?.elements.head ?? []).flatMap((element) => element.slots),
  ]);
  const rules = (['base', 'head'] as const).flatMap((side) =>
    (detail.extraction?.[side]?.rules ?? [])
      .filter((rule) => rule.slot && slots.has(rule.slot))
      .map((rule) => ({ ...rule, side })),
  );
  const baseText = Object.values(evidence?.declarations.base ?? {}).join('\n');
  const headText = Object.values(evidence?.declarations.head ?? {}).join('\n');
  const shorthands = shorthandsIn(baseText).filter(
    (name) => !shorthandsIn(headText).includes(name),
  );
  const total = columns.length * Math.max(record?.plan.combos.length ?? 1, 1);
  return (
    <div>
      <Step index={1} title="源码里声明了什么">
        <div {...stylex.props(styles.two)}>
          <div>
            <div {...stylex.props(styles.label)}>base</div>
            <Declarations texts={evidence?.declarations.base} />
          </div>
          <div>
            <div {...stylex.props(styles.label)}>head</div>
            <Declarations texts={evidence?.declarations.head} />
          </div>
        </div>
      </Step>
      <Step index={2} title="真正生效的规则">
        <div {...stylex.props(styles.note)}>
          {shorthands.length === 0 &&
            rules.length === 0 &&
            '两侧都只有元素自身的声明，没有嵌套选择器。'}
          {shorthands.map((name) => (
            <p key={name}>
              base 用了 shorthand <code>{name}</code>，它会把没写到的子属性重置为初始值；head 拆成了
              longhand。 只要这些子属性在这个元素上本来就是初始值，就不会产生差异
              {CORPUS_FOR[name] && (
                <>
                  ，别的规则设置了它们时的情况由边界语料{' '}
                  <a href={hrefOf({ anchor: CORPUS_FOR[name], kind: 'method' })}>
                    {CORPUS_FOR[name]}
                  </a>{' '}
                  覆盖
                </>
              )}
              。
            </p>
          ))}
          {rules.length > 0 && (
            <ul {...stylex.props(styles.list)}>
              {rules.map((rule) => (
                <li key={`${rule.side}${rule.selector}${rule.conditions.join()}`}>
                  {rule.side}：<code>{rule.selector}</code>
                  {rule.conditions.length ? ` · ${rule.conditions.join(' · ')}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Step>
      <Step index={3} title="在什么 DOM 上比较">
        <div {...stylex.props(styles.note)}>
          base：<code>{chainText(evidence?.elements.base)}</code>；head：
          <code>{chainText(evidence?.elements.head)}</code>。
          {record?.plan.variables.length
            ? ` 条件变量 ${record.plan.variables.map((variable) => variable.name).join('、')}，共 ${record.plan.combos.length} 种组合。`
            : ' 没有条件变量。'}
          {flags.length > 0 && (
            <ul {...stylex.props(styles.list)}>
              {flags.map((flag) => (
                <li key={flag}>
                  <a href={hrefOf({ anchor: flag, kind: 'method' })}>{flagLabel(flag)}</a>（{flag}
                  ）：这一点合成环境证明不了，需要人工确认。
                </li>
              ))}
            </ul>
          )}
        </div>
      </Step>
      <Step index={4} title="在哪些条件下比较">
        {record && (
          <div {...stylex.props(styles.strip)}>
            <MatrixStrip large columns={columns} entry={record} />
          </div>
        )}
        <div {...stylex.props(styles.note)}>
          每行一个主题，每列一个宽度和状态的组合。base 加载两次自比（A/A）：
          {record?.result.unstableConditions.length
            ? `${record.result.unstableConditions.length} 个条件不稳定，这个用例阻塞。`
            : `${columns.length} / ${columns.length} 稳定。`}
        </div>
      </Step>
      <Step index={5} title="比较的结果">
        <div {...stylex.props(styles.note)}>
          {total} 个条件 × 组合里，{record?.result.differingConditions.length ?? 0} 个条件出现差异。
          {record?.result.rootCauses.length ? (
            <ul {...stylex.props(styles.list)}>
              {record.result.rootCauses.map((cause) => (
                <li key={`${cause.key}${cause.property}${cause.before}`}>
                  <code>{cause.key}</code> {cause.property}：{cause.before ?? '∅'} →{' '}
                  {cause.after ?? '∅'}
                </li>
              ))}
            </ul>
          ) : (
            ' 所有计算属性和盒子尺寸逐项一致。'
          )}
          右侧可以按条件逐项对照。
        </div>
      </Step>
    </div>
  );
};
