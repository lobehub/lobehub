import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode, useEffect, useState } from 'react';

import { type CorpusEntry, fetchMethod, type RunPayload, type SelfTestPayload } from '../api';
import { UNMODELED_SHAPES } from '../knownGaps';
import { FLAG_EXPLANATIONS, flagLabel, shortKey } from '../labels';
import { aaSummary, conditionScope } from '../method';
import { hrefOf } from '../route';

const styles = stylex.create({
  code: { fontFamily: cssVar.fontFamilyCode, fontSize: cssVar.fontSizeSM },
  corpus: { columnGap: 16, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  heading: { fontSize: cssVar.fontSizeLG, fontWeight: 600, marginBlock: 0 },
  muted: { color: cssVar.colorTextTertiary },
  row: {
    alignItems: 'baseline',
    borderRadius: cssVar.borderRadiusSM,
    columnGap: 8,
    display: 'flex',
    fontSize: cssVar.fontSizeSM,
    minWidth: 0,
    paddingBlock: 4,
    paddingInline: 4,
  },
  rowBad: { color: cssVar.colorError },
  spread: { justifyContent: 'space-between' },
  subheading: {
    color: cssVar.colorTextSecondary,
    fontSize: cssVar.fontSizeSM,
    fontWeight: 600,
    marginBlockEnd: 8,
    marginBlockStart: 16,
  },
  target: { backgroundColor: cssVar.colorWarningBg },
  title: { fontSize: cssVar.fontSizeHeading4, fontWeight: 600, marginBlock: 0 },
});

const Card = ({
  children,
  count,
  lead,
  title,
}: {
  children: ReactNode;
  count?: ReactNode;
  lead: string;
  title: string;
}) => (
  <Block as="section" gap={12} padding={20} variant="outlined">
    <Flexbox gap={4}>
      <Flexbox horizontal align="baseline" gap={8}>
        <h2 {...stylex.props(styles.heading)}>{title}</h2>
        {count !== undefined && (
          <Text fontSize={12} type="secondary">
            {count}
          </Text>
        )}
      </Flexbox>
      <Text fontSize={12} type="secondary">
        {lead}
      </Text>
    </Flexbox>
    <div>{children}</div>
  </Block>
);

const passedOf = (entries: CorpusEntry[]) =>
  `${entries.filter((entry) => entry.passed).length} / ${entries.length} 通过`;

const CorpusList = ({ anchor, entries }: { anchor?: string; entries: CorpusEntry[] }) => (
  <div {...stylex.props(styles.corpus)}>
    {entries.map((entry) => (
      <div
        id={entry.id}
        key={entry.id}
        title={entry.passed ? undefined : `期望 ${entry.expected}，实际 ${entry.actual}`}
        {...stylex.props(
          styles.row,
          !entry.passed && styles.rowBad,
          anchor === entry.id && styles.target,
        )}
      >
        <span>{entry.passed ? '✓' : '✗'}</span>
        <code {...stylex.props(styles.code)}>{entry.id}</code>
        <span {...stylex.props(styles.muted)}>{entry.feature}</span>
      </div>
    ))}
  </div>
);

const SelfTest = ({
  anchor,
  selfTest,
}: {
  anchor?: string;
  selfTest: SelfTestPayload | null | undefined;
}) => {
  if (selfTest === undefined) return <Text type="secondary">正在读取自检结果…</Text>;
  if (!selfTest)
    return (
      <Text type="secondary">
        还没有自检记录。运行 <code {...stylex.props(styles.code)}>bun run style-eq self-test</code>{' '}
        后刷新这一页。
      </Text>
    );
  return (
    <>
      <Text fontSize={12} type="secondary">
        验证器 {selfTest.verifierVersion} · {new Date(selfTest.ranAt).toLocaleString('zh-CN')}
      </Text>
      <h4 {...stylex.props(styles.subheading)}>CSS 语料 · {passedOf(selfTest.css)}</h4>
      <CorpusList anchor={anchor} entries={selfTest.css} />
      <h4 {...stylex.props(styles.subheading)}>源码语料 · {passedOf(selfTest.source)}</h4>
      <CorpusList anchor={anchor} entries={selfTest.source} />
    </>
  );
};

export const MethodPage = ({ anchor, payload }: { anchor?: string; payload: RunPayload }) => {
  const [selfTest, setSelfTest] = useState<SelfTestPayload | null>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    fetchMethod()
      .then((value) => setSelfTest(value.selfTest))
      .catch((reason: unknown) => setError(String(reason)));
  }, []);
  useEffect(() => {
    if (anchor && selfTest !== undefined)
      document.getElementById(anchor)?.scrollIntoView({ block: 'center' });
  }, [anchor, selfTest]);
  const conditions = payload.run.conditions ?? [];
  const aa = aaSummary(payload.cases, conditions.length);
  const { mutation } = payload;
  return (
    <Flexbox gap={16} style={{ maxWidth: 1200 }}>
      <Flexbox gap={4}>
        <h1 {...stylex.props(styles.title)}>方法依据</h1>
        <Text type="secondary">
          「相等」的意思是：<b>在列出的条件下，两侧每个元素的全部计算属性和盒模型逐项一致</b>
          。下面几项说明为什么这个比较可信，以及它看不到什么。
        </Text>
      </Flexbox>
      <Card
        lead="每一类 CSS 差异都构造一对已知结果的样式，确认比较器该报的报出来、不该报的不报。"
        title="边界语料"
      >
        {error ? (
          <Text type="danger">读取自检结果失败：{error}</Text>
        ) : (
          <SelfTest anchor={anchor} selfTest={selfTest} />
        )}
      </Card>
      <Card
        count={`${mutation.caught} / ${mutation.evaluated} 抓到`}
        lead="往 head 里注入已知的改动，确认每个都在预期的条件下被报出来。"
        title="本次运行的变异测试"
      >
        {mutation.mutants.map((mutant) => (
          <div
            key={`${mutant.caseKey}${mutant.description}`}
            {...stylex.props(
              styles.row,
              styles.spread,
              mutant.outcome === 'missed' && styles.rowBad,
            )}
          >
            <span>
              {mutant.outcome === 'caught' ? '✓' : mutant.outcome === 'equivalent' ? '≈' : '✗'}{' '}
              <code {...stylex.props(styles.code)}>{mutant.description}</code>{' '}
              <a
                href={hrefOf({ key: mutant.caseKey, kind: 'case' })}
                {...stylex.props(styles.muted)}
              >
                {shortKey(mutant.caseKey)}
              </a>
            </span>
            <span {...stylex.props(styles.muted)}>
              {mutant.gaps?.length
                ? mutant.gaps.map(flagLabel).join('、')
                : conditionScope(mutant.expected, conditions.length)}
            </span>
          </div>
        ))}
      </Card>
      <Card
        count={aa.unstable.length ? `${aa.unstable.length} 个用例不稳定` : '全部稳定'}
        lead="base 自己和自己比两次。自比都不一致的用例，任何结论都不算数，标为阻塞。"
        title="A/A 稳定性"
      >
        <div {...stylex.props(styles.row)}>
          {aa.checks} 次自比（{payload.cases.length} 个用例 × {conditions.length} 个条件）
        </div>
        {aa.unstable.map((entry) => (
          <div key={entry.key} {...stylex.props(styles.row, styles.rowBad)}>
            <a href={hrefOf({ key: entry.key, kind: 'case' })}>{shortKey(entry.key)}</a>
            <span>{entry.conditions.join('、')}</span>
          </div>
        ))}
      </Card>
      <Card lead="遇到下面的情况，用例进入签收清单，而不是标成相等。" title="已知盲区">
        {Object.entries(FLAG_EXPLANATIONS).map(([flag, text]) => (
          <div id={flag} key={flag} {...stylex.props(styles.row, anchor === flag && styles.target)}>
            <b>{flagLabel(flag)}</b>
            <code {...stylex.props(styles.code, styles.muted)}>{flag}</code>
            <span>{text}</span>
          </div>
        ))}
      </Card>
      <Card lead="下面这些写法工具还没有建模，结果里可能出现不是真差异的差异。" title="尚未建模">
        {UNMODELED_SHAPES.map((entry) => (
          <div key={entry.title} {...stylex.props(styles.row)}>
            <b>{entry.title}</b>
            <span>{entry.text}</span>
          </div>
        ))}
      </Card>
    </Flexbox>
  );
};
