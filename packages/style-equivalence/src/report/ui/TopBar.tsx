import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import type { FollowInfo, RunPayload } from '../api';
import { CATEGORY_LABELS } from '../labels';
import { hrefOf } from '../route';
import { RunBadge } from './RunBadge';

const styles = stylex.create({
  bar: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgContainer,
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    columnGap: 12,
    display: 'flex',
    height: 48,
    paddingInline: 20,
  },
  brand: { color: cssVar.colorText, fontSize: 13, fontWeight: 600, textDecorationLine: 'none' },
  brandNote: { color: cssVar.colorTextTertiary, fontWeight: 400 },
  link: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorder,
    borderRadius: 6,
    borderStyle: 'solid',
    borderWidth: 1,
    color: cssVar.colorText,
    display: 'inline-flex',
    fontSize: 13,
    height: 28,
    paddingInline: 10,
    textDecorationLine: 'none',
  },
  muted: { color: cssVar.colorTextSecondary },
  rev: {
    backgroundColor: cssVar.colorFillQuaternary,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 4,
    borderStyle: 'solid',
    borderWidth: 1,
    color: cssVar.colorTextSecondary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    paddingBlock: 1,
    paddingInline: 6,
  },
  spacer: { flex: '1' },
  strip: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgContainer,
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    columnGap: 12,
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: 13,
    minHeight: 44,
    paddingBlock: 8,
    paddingInline: 20,
  },
  verdict: { fontWeight: 600 },
  verdictBad: { color: cssVar.colorError },
  verdictOk: { color: cssVar.colorSuccess },
});

export const TopBar = ({ follow, run }: { follow?: FollowInfo; run: RunPayload['run'] }) => (
  <header {...stylex.props(styles.bar)}>
    <a href={hrefOf({ kind: 'overview' })} {...stylex.props(styles.brand)}>
      style-equivalence <span {...stylex.props(styles.brandNote)}>· 本地报告</span>
    </a>
    <span {...stylex.props(styles.rev)}>{run.base.slice(0, 7)}</span>
    <span {...stylex.props(styles.muted)}>→</span>
    <span {...stylex.props(styles.rev)}>{run.head.slice(0, 7)}</span>
    <RunBadge follow={follow} />
    <div {...stylex.props(styles.spacer)} />
    <a href={hrefOf({ kind: 'review' })} {...stylex.props(styles.link)}>
      复查
    </a>
    <a href={hrefOf({ kind: 'method' })} {...stylex.props(styles.link)}>
      方法依据
    </a>
  </header>
);

export const VerdictStrip = ({ payload }: { payload: RunPayload }) => {
  const { cases, mutation, verdict } = payload;
  const count = (category: string) => cases.filter((entry) => entry.category === category).length;
  const unpaired = verdict.items.filter((item) => item.category === 'unpaired').length;
  const files = new Set(cases.map((entry) => entry.plan.file)).size;
  const parts = [
    `${CATEGORY_LABELS.difference} ${count('difference')}`,
    `${CATEGORY_LABELS['needs-signoff']} ${count('needs-signoff') + unpaired}`,
    `${CATEGORY_LABELS.blocking} ${count('blocking')}`,
    `${CATEGORY_LABELS.equal} ${count('equal')}`,
    `共 ${cases.length} 个用例，${files} 个文件`,
    mutation.requested ? `变异 ${mutation.caught}/${mutation.evaluated}` : '变异未运行',
  ];
  return (
    <div {...stylex.props(styles.strip)}>
      <span
        {...stylex.props(styles.verdict, verdict.mergeable ? styles.verdictOk : styles.verdictBad)}
      >
        {verdict.mergeable ? '可以合并' : '还不能合并'}
      </span>
      <span {...stylex.props(styles.muted)}>{parts.join(' · ')}</span>
      {!verdict.mergeable && (
        <span {...stylex.props(styles.muted)}>原因：{verdict.reasons.join('；')}</span>
      )}
    </div>
  );
};
