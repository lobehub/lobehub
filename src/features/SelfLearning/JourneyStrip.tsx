'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainItem } from '@/services/expertise';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;
  `,
  connector: css`
    flex: 1;
    height: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  dot: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 999px;
  `,
  dotDone: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border: 1px solid ${cssVar.colorSuccess};
    border-radius: 999px;

    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorSuccess};
  `,
}));

interface JourneyStripProps {
  domains: ExpertiseDomainItem[];
}

/**
 * 自进化的三步路径：定方向 → 积累实践 → 看状态。
 *
 * 验收原话是「缺少一个完整的使用流程的 tracing，从用户一开始看到，到使用过程中积累数据，
 * 再到最后检查状态」。此前每一屏各自成立，但没有任何地方说明它们连起来是一条什么路 ——
 * 第一次进来的人看见一堆曲线，不知道自己该做什么才能让它动起来。
 *
 * 每步显示已经走到这一步的专长数，所以它同时是导航和进度：三步全亮 = 这个 agent 的
 * 自进化真的转起来了；卡在第二步 = 方向定了但没人用它干活。
 */
const JourneyStrip = memo<JourneyStripProps>(({ domains }) => {
  const { t } = useTranslation('selfLearning');

  const anchored = domains.filter((d) => !d.anchorPending).length;
  const practised = domains.filter((d) => d.runCount > 0).length;
  const readable = domains.filter((d) => d.maturity.usable).length;

  const steps: { desc: string; done: boolean; n: number; title: string }[] = [
    { desc: t('journey.step1Desc'), done: anchored > 0, n: anchored, title: t('journey.step1') },
    { desc: t('journey.step2Desc'), done: practised > 0, n: practised, title: t('journey.step2') },
    { desc: t('journey.step3Desc'), done: readable > 0, n: readable, title: t('journey.step3') },
  ];

  return (
    <Flexbox horizontal align={'center'} className={styles.bar} gap={12}>
      {steps.map((s, i) => (
        <Flexbox horizontal align={'center'} gap={12} key={s.title} style={{ flex: 1 }}>
          <Flexbox horizontal align={'center'} gap={9} style={{ flex: 'none' }}>
            <div className={s.done ? styles.dotDone : styles.dot}>
              {s.done ? (
                <Icon icon={CheckIcon} size={11} />
              ) : (
                <Text fontSize={10} type={'secondary'}>
                  {i + 1}
                </Text>
              )}
            </div>
            <Flexbox gap={1}>
              <Text fontSize={12.5} type={s.done ? undefined : 'secondary'} weight={600}>
                {s.title}
              </Text>
              <Text fontSize={11} type={'secondary'}>
                {t('journey.count', { count: s.n })} · {s.desc}
              </Text>
            </Flexbox>
          </Flexbox>
          {i < steps.length - 1 && <div className={styles.connector} />}
        </Flexbox>
      ))}
    </Flexbox>
  );
});

JourneyStrip.displayName = 'JourneyStrip';

export default JourneyStrip;
