'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleCheckBigIcon, PlayIcon, RotateCcwIcon, TargetIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  loopBack: css`
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  loopIcon: css`
    flex: none;
    margin-block-start: 1px;
    color: ${cssVar.colorTextQuaternary};
  `,
  step: css`
    padding-block: 14px;
    padding-inline: 16px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
  stepIndex: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border-radius: 999px;

    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
}));

interface StepProps {
  desc: string;
  icon: typeof TargetIcon;
  index: number;
  title: string;
}

const Step = memo<StepProps>(({ desc, icon, index, title }) => (
  <Flexbox className={styles.step} gap={8}>
    <Flexbox horizontal align={'center'} gap={8}>
      <span className={styles.stepIndex}>{index}</span>
      <Icon icon={icon} size={14} style={{ flexShrink: 0 }} />
      <Text fontSize={13} weight={600}>
        {title}
      </Text>
    </Flexbox>
    <Text fontSize={12} style={{ lineHeight: 1.65 }} type={'secondary'}>
      {desc}
    </Text>
  </Flexbox>
));

Step.displayName = 'GoalHowItWorksStep';

/**
 * The mechanism behind a goal: what each round does and how it ends.
 *
 * This used to sit inline on the empty state, where it pushed the actual
 * starting points (the create button and the seeded examples) below the fold
 * on every visit — including the tenth one, when the user already knows how it
 * works. It now lives behind a hint at the bottom of the empty state, so the
 * explanation is one click away instead of a permanent tax.
 *
 * Stacked vertically here: a modal is narrow, and the three steps are a
 * sequence, so reading them top-to-bottom matches how they actually run.
 */
const HowItWorksContent = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox gap={10}>
      <Step
        desc={t('goalEmpty.step1.desc')}
        icon={TargetIcon}
        index={1}
        title={t('goalEmpty.step1.title')}
      />
      <Step
        desc={t('goalEmpty.step2.desc')}
        icon={PlayIcon}
        index={2}
        title={t('goalEmpty.step2.title')}
      />
      <Step
        desc={t('goalEmpty.step3.desc')}
        icon={CircleCheckBigIcon}
        index={3}
        title={t('goalEmpty.step3.title')}
      />
      <Flexbox horizontal align={'flex-start'} className={styles.loopBack} gap={8}>
        <Icon className={styles.loopIcon} icon={RotateCcwIcon} size={13} />
        <Text fontSize={12} style={{ lineHeight: 1.6 }} type={'secondary'}>
          {t('goalEmpty.loop')}
        </Text>
      </Flexbox>
    </Flexbox>
  );
});

HowItWorksContent.displayName = 'GoalHowItWorksContent';

export default HowItWorksContent;
