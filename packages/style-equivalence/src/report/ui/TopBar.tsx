import { Flexbox, Segmented, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight } from 'lucide-react';

import type { FollowInfo, RunPayload } from '../api';
import { CATEGORY_LABELS } from '../labels';
import { hrefOf } from '../route';
import { RunBadge } from './RunBadge';
import { ThemeToggle } from './ThemeToggle';

const styles = stylex.create({
  bar: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgContainer,
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    columnGap: 16,
    display: 'flex',
    flex: 'none',
    height: 52,
    paddingInline: 20,
  },
  brand: {
    color: cssVar.colorText,
    fontSize: cssVar.fontSize,
    fontWeight: 600,
    textDecorationLine: 'none',
  },
  nav: { alignSelf: 'center' },
  spacer: { flex: '1' },
  strip: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgContainer,
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    columnGap: 16,
    display: 'flex',
    flex: 'none',
    flexWrap: 'wrap',
    minHeight: 40,
    paddingBlock: 8,
    paddingInline: 20,
    rowGap: 4,
  },
});

export type Section = 'method' | 'overview' | 'review';

const SECTIONS: Array<{ label: string; value: Section }> = [
  { label: '总览', value: 'overview' },
  { label: '复查', value: 'review' },
  { label: '方法依据', value: 'method' },
];

const SECTION_HREFS: Record<Section, string> = {
  method: hrefOf({ kind: 'method' }),
  overview: hrefOf({ kind: 'overview' }),
  review: hrefOf({ kind: 'review' }),
};

export const TopBar = ({
  base,
  follow,
  head,
  section,
}: {
  base: string;
  follow?: FollowInfo;
  head: string;
  section: Section;
}) => (
  <header {...stylex.props(styles.bar)}>
    <a href={hrefOf({ kind: 'overview' })} {...stylex.props(styles.brand)}>
      style-equivalence
    </a>
    <Flexbox horizontal align="center" gap={6}>
      <Text code fontSize={12}>
        {base.slice(0, 7)}
      </Text>
      <ArrowRight aria-label="到" size={12} />
      <Text code fontSize={12}>
        {head.slice(0, 7)}
      </Text>
    </Flexbox>
    <RunBadge follow={follow} />
    <div {...stylex.props(styles.spacer)} />
    <Segmented
      className={stylex.props(styles.nav).className}
      options={SECTIONS}
      size="small"
      value={section}
      onChange={(value) => {
        location.hash = SECTION_HREFS[value];
      }}
    />
    <ThemeToggle />
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
    `共 ${cases.length} 个用例、${files} 个文件`,
    mutation.requested ? `变异 ${mutation.caught}/${mutation.evaluated}` : '变异未运行',
  ];
  return (
    <div {...stylex.props(styles.strip)}>
      <Text strong type={verdict.mergeable ? 'success' : 'danger'}>
        {verdict.mergeable ? '可以合并' : '还不能合并'}
      </Text>
      <Text type="secondary">{parts.join(' · ')}</Text>
      {!verdict.mergeable && (
        <Text fontSize={12} type="secondary">
          原因：{verdict.reasons.join('；')}
        </Text>
      )}
    </div>
  );
};
