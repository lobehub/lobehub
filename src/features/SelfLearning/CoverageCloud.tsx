'use client';

import { Block, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainDetail } from '@/services/expertise';

/** 三档底色，用现成 token 而不是自己算 rgba —— 深浅色主题各自成立。 */
const FILLS = [
  'transparent',
  cssVar.colorFillQuaternary,
  cssVar.colorFillTertiary,
  cssVar.colorFillSecondary,
];

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    padding-block: 5px;
    padding-inline: 11px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;
  `,
  /** 空层不给底色 —— 它要看得见，但不能看起来像「有内容」。 */
  chipEmpty: css`
    padding-block: 5px;
    padding-inline: 11px;
    border: 1px dashed ${cssVar.colorWarningBorder};
    border-radius: 999px;
  `,
}));

interface CoverageCloudProps {
  detail: ExpertiseDomainDetail;
}

/**
 * 学习覆盖面 —— 一眼看出它把力气花在了哪一层。
 *
 * 验收原话：「需要一个类似词云或者领域快照之类的东西……现在那个次数统计看着太平了，
 * 没有全局 overview 的感觉」。一列对齐的数字确实是平的：73 和 1 在视觉上一样重，
 * 得逐行读才能比出来。这里让字号与底色浓度随条数走，偏科就是画面上的大小对比本身，
 * 不需要读数字。
 *
 * 空层保留为虚线圈：它是 canonical 分层照出来的缺口，而缺口恰恰是这张图最该被看见的部分。
 */
const CoverageCloud = memo<CoverageCloudProps>(({ detail }) => {
  const { t } = useTranslation('selfLearning');
  const { domain, layerCounts, lessonStats } = detail;

  const chips = useMemo(() => {
    const layers = domain.layers ?? [];
    const max = Math.max(1, ...layers.map((l) => layerCounts[l.key] ?? 0));
    return layers
      .map((l) => {
        const count = layerCounts[l.key] ?? 0;
        const ratio = count / max;
        return {
          count,
          fontSize: 12 + Math.round(ratio * 10),
          key: l.key,
          // 底色也跟着分三档：字号之外再给一层冗余编码，小屏或弱视也能读出轻重
          level: count === 0 ? 0 : ratio > 0.66 ? 3 : ratio > 0.33 ? 2 : 1,
          title: l.title,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [domain.layers, layerCounts]);

  if (chips.length === 0) return null;

  return (
    <Block gap={10} padding={16} variant={'outlined'}>
      <Flexbox horizontal align={'baseline'} gap={10} justify={'space-between'} wrap={'wrap'}>
        <Text fontSize={13} weight={600}>
          {t('coverage.title')}
        </Text>
        <Text fontSize={11} type={'secondary'}>
          {t('coverage.sub', {
            covered: chips.filter((c) => c.count > 0).length,
            total: chips.length,
            unused: lessonStats.unused,
          })}
        </Text>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        {chips.map((c) => (
          <Tooltip
            key={c.key}
            title={c.count === 0 ? t('coverage.blankHint') : t('layers.count', { count: c.count })}
          >
            <Flexbox
              horizontal
              align={'baseline'}
              className={c.count === 0 ? styles.chipEmpty : styles.chip}
              gap={6}
              style={c.count === 0 ? undefined : { background: FILLS[c.level] }}
            >
              <Text fontSize={c.fontSize} type={c.count === 0 ? 'warning' : undefined} weight={600}>
                {c.title}
              </Text>
              <Text fontSize={11} type={'secondary'}>
                {c.count === 0 ? t('layers.blank') : c.count}
              </Text>
            </Flexbox>
          </Tooltip>
        ))}
      </Flexbox>
    </Block>
  );
});

CoverageCloud.displayName = 'CoverageCloud';

export default CoverageCloud;
