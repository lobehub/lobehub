'use client';

import { Flexbox, Icon, Steps, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { RotateCcwIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  loopBack: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
  loopIcon: { flex: 'none', marginBlockStart: '1px', color: cssVar.colorTextQuaternary },
});

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
 * Omitting `current` leaves every step in its neutral state — this explains the
 * loop, it does not track a run's progress.
 */
const HowItWorksContent = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox gap={12}>
      <Steps
        orientation={'vertical'}
        items={[1, 2, 3].map((index) => ({
          description: t(`goalEmpty.step${index}.desc` as never),
          title: t(`goalEmpty.step${index}.title` as never),
        }))}
        styles={{
          description: { fontSize: 12, lineHeight: 1.65 },
          title: { fontSize: 13, fontWeight: 600 },
        }}
      />
      <Flexbox
        horizontal
        align={'flex-start'}
        className={stylex.props(styles.loopBack).className}
        gap={8}
      >
        <Icon className={stylex.props(styles.loopIcon).className} icon={RotateCcwIcon} size={13} />
        <Text fontSize={12} style={{ lineHeight: 1.6 }} type={'secondary'}>
          {t('goalEmpty.loop')}
        </Text>
      </Flexbox>
    </Flexbox>
  );
});

HowItWorksContent.displayName = 'GoalHowItWorksContent';

export default HowItWorksContent;
