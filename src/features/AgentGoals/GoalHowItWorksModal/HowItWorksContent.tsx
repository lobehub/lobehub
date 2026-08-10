'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Steps } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { RotateCcwIcon } from 'lucide-react';
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
  steps: css`
    .ant-steps-item-title {
      font-size: 13px;
      font-weight: 600;
    }

    .ant-steps-item-description {
      font-size: 12px;
      line-height: 1.65;
    }
  `,
}));

/**
 * The mechanism behind a goal: what each round does and how it ends.
 *
 * This used to sit inline on the empty state, where it pushed the actual
 * starting points (the create button and the seeded examples) below the fold
 * on every visit — including the tenth one, when the user already knows how it
 * works. It now lives behind a hint at the bottom of the empty state, so the
 * explanation is one click away instead of a permanent tax.
 *
 * The three steps run as a vertical `Steps`: they are a sequence, and the rail
 * that connects them carries that ordering better than three separate cards.
 * `current={-1}` leaves every step in its neutral state — this explains the
 * loop, it does not track a run's progress.
 */
const HowItWorksContent = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox gap={12}>
      <Steps
        className={styles.steps}
        current={-1}
        direction={'vertical'}
        size={'small'}
        items={[1, 2, 3].map((index) => ({
          description: t(`goalEmpty.step${index}.desc` as never),
          title: t(`goalEmpty.step${index}.title` as never),
        }))}
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
