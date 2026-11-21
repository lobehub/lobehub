'use client';

import { createStaticStyles, cssVar, Flexbox, Text } from '@lobehub/ui';
import { Cpu, MessageSquare, Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    padding-block: 18px;
    padding-inline: 22px;
    border: 1px solid rgb(160 120 255 / 22%);
    border-radius: ${cssVar.borderRadiusLG};

    background: linear-gradient(135deg, rgb(139 92 246 / 14%), rgb(139 92 246 / 4%));
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  icon: css`
    color: #a78bfa;
  `,
  steps: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;

    @media (width <= 640px) {
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
    }
  `,
  step: css`
    display: flex;
    gap: 12px;
    align-items: flex-start;
    min-width: 0;
  `,
  index: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 50%;

    font-size: 12px;
    font-weight: 600;
    color: #fff;

    background: linear-gradient(135deg, #8b5cf6, #6d28d9);
  `,
  stepBody: css`
    min-width: 0;
  `,
}));

const STEPS = [
  { desc: 'dashboard.quickStart.step1.desc', icon: Cpu, title: 'dashboard.quickStart.step1.title' },
  {
    desc: 'dashboard.quickStart.step2.desc',
    icon: MessageSquare,
    title: 'dashboard.quickStart.step2.title',
  },
  { desc: 'dashboard.quickStart.step3.desc', icon: Sparkles, title: 'dashboard.quickStart.step3.title' },
];

/**
 * Onboarding hint above the composer: three steps from picking a model to
 * reading the reply. Pure guide, nothing to click — the composer below is where
 * every step happens.
 */
const QuickStartCard = memo(() => {
  const { t } = useTranslation('home');

  return (
    <Flexbox className={styles.card} gap={14} data-testid={'home-quick-start'}>
      <div className={styles.header}>
        <Sparkles className={styles.icon} size={16} />
        <Text as={'h3'} style={{ fontSize: 15, margin: 0 }} weight={600}>
          {t('dashboard.quickStart.title')}
        </Text>
      </div>
      <div className={styles.steps}>
        {STEPS.map(({ desc, icon: StepIcon, title }, index) => (
          <div className={styles.step} key={title}>
            <div className={styles.index}>{index + 1}</div>
            <div className={styles.stepBody}>
              <Flexbox horizontal align={'center'} gap={6}>
                <StepIcon className={styles.icon} size={14} />
                <Text style={{ fontSize: 14 }} weight={500}>
                  {t(title)}
                </Text>
              </Flexbox>
              <Text style={{ fontSize: 12, lineHeight: 1.6 }} type={'secondary'}>
                {t(desc)}
              </Text>
            </div>
          </div>
        ))}
      </div>
    </Flexbox>
  );
});

export default QuickStartCard;
