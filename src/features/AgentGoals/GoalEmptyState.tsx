'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  CheckIcon,
  CircleCheckBigIcon,
  InfinityIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  TargetIcon,
  XIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { GoalExampleSeed } from './goalExamples';
import { buildGoalExampleSeed, GOAL_EXAMPLE_KEYS } from './goalExamples';

const styles = createStaticStyles(({ css }) => ({
  example: css`
    cursor: pointer;

    padding-block: 12px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    transition: all 0.15s ${cssVar.motionEaseOut};

    &:hover {
      border-color: ${cssVar.colorPrimaryBorder};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  exampleGrid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;

    @media (width <= 860px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  hero: css`
    isolation: isolate;
    position: relative;

    overflow: hidden;

    padding-block: 40px 32px;
    padding-inline: 40px;

    text-align: center;
  `,
  heroIcon: css`
    position: relative;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;
    border-radius: 14px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
    box-shadow:
      0 0 0 1px ${cssVar.colorBorderSecondary},
      0 8px 28px ${cssVar.colorFillSecondary};

    &::before {
      content: '';

      position: absolute;
      z-index: -1;
      inset: -2px;

      border-radius: 16px;

      background: conic-gradient(
        from 0deg,
        transparent 0deg,
        ${cssVar.colorPrimary} 70deg,
        ${cssVar.colorInfo} 120deg,
        transparent 180deg
      );
      filter: blur(6px);

      animation: goal-icon-flow 4s linear infinite;
    }

    @keyframes goal-icon-flow {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      &::before {
        animation: none;
      }
    }
  `,
  heroInner: css`
    position: relative;
    z-index: 1;
  `,
  heroPattern: css`
    pointer-events: none;

    position: absolute;
    z-index: 0;
    inset-block-start: 0;
    inset-inline: 50%;
    transform: translateX(-50%);

    width: min(760px, 100%);
    height: 220px;

    opacity: 0.48;
    background-image: radial-gradient(circle, ${cssVar.colorTextQuaternary} 1px, transparent 1.5px);
    background-position: 0 0;
    background-size: 18px 18px;

    animation: goal-pattern-flow 8s linear infinite;

    mask-image: radial-gradient(ellipse 62% 72% at 50% 25%, #000 15%, transparent 78%);

    @keyframes goal-pattern-flow {
      to {
        background-position: 36px 18px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
  heroLead: css`
    max-width: 560px;
    line-height: 1.7;
  `,
  judge: css`
    padding-block: 10px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
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
  section: css`
    padding-block: 24px;
    padding-inline: 40px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  step: css`
    min-width: 0;
    height: 100%;
    padding-block: 14px;
    padding-inline: 16px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  stepHead: css`
    /* Reserve a stable header height so the descriptions below start on the same
       line across all three cards, even if one title wraps. */
    min-height: 20px;
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
  steps: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    align-items: stretch;

    @media (width <= 860px) {
      grid-template-columns: minmax(0, 1fr);
    }
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
    <Flexbox horizontal align={'center'} className={styles.stepHead} gap={8}>
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

Step.displayName = 'GoalEmptyStateStep';

interface GoalEmptyStateProps {
  onCreate: (seed?: GoalExampleSeed) => void;
}

/**
 * First-run empty state for the goal list.
 *
 * A goal only pays off if the user understands the bargain before making one:
 * it runs autonomously, judges itself each round, and spends budget doing it.
 * "Goals will appear here" taught none of that, so this screen carries the
 * concept (what a goal is), the mechanism (what happens after you create one),
 * and three seeded examples that demonstrate what a *judgeable* outcome reads
 * like.
 */
const GoalEmptyState = memo<GoalEmptyStateProps>(({ onCreate }) => {
  const { t } = useTranslation('chat');

  return (
    <Block padding={0} variant={'borderless'}>
      <Flexbox align={'center'} className={styles.hero}>
        <div className={styles.heroPattern} />
        <Flexbox align={'center'} className={styles.heroInner} gap={16}>
          <div className={styles.heroIcon}>
            <Icon icon={InfinityIcon} size={24} />
          </div>
          <Flexbox align={'center'} gap={8}>
            <Text fontSize={20} weight={600}>
              {t('goalEmpty.title')}
            </Text>
            <Text className={styles.heroLead} fontSize={14} type={'secondary'}>
              {t('goalEmpty.lead')}
            </Text>
          </Flexbox>
          <Button icon={PlusIcon} type={'primary'} onClick={() => onCreate()}>
            {t('goalEmpty.create')}
          </Button>
        </Flexbox>
      </Flexbox>

      <Flexbox className={styles.section} gap={14}>
        <Text fontSize={13} type={'secondary'} weight={600}>
          {t('goalEmpty.howTitle')}
        </Text>
        <div className={styles.steps}>
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
        </div>
        <Flexbox horizontal align={'flex-start'} className={styles.loopBack} gap={8}>
          <Icon className={styles.loopIcon} icon={RotateCcwIcon} size={13} />
          <Text fontSize={12} style={{ lineHeight: 1.6 }} type={'secondary'}>
            {t('goalEmpty.loop')}
          </Text>
        </Flexbox>
      </Flexbox>

      <Flexbox className={styles.section} gap={12}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text fontSize={13} type={'secondary'} weight={600}>
            {t('goalEmpty.examplesTitle')}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {t('goalEmpty.examplesHint')}
          </Text>
        </Flexbox>
        <div className={styles.exampleGrid}>
          {GOAL_EXAMPLE_KEYS.map((key) => {
            const seed = buildGoalExampleSeed(key, (localeKey) => t(localeKey as never));

            return (
              <Flexbox
                className={styles.example}
                gap={6}
                key={key}
                role={'button'}
                tabIndex={0}
                onClick={() => onCreate(seed)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onCreate(seed);
                }}
              >
                <Text fontSize={11} type={'secondary'}>
                  {t(`goalEmpty.examples.${key}.tag` as never)}
                </Text>
                <Text fontSize={13} weight={500}>
                  {seed.title}
                </Text>
                <Text ellipsis={{ rows: 2 }} fontSize={12} type={'secondary'}>
                  {t('goalEmpty.examples.requirementPrefix', { requirement: seed.requirement })}
                </Text>
              </Flexbox>
            );
          })}
        </div>

        <Flexbox className={styles.judge} gap={6}>
          <Flexbox horizontal align={'flex-start'} gap={8}>
            <Icon
              color={cssVar.colorError}
              icon={XIcon}
              size={13}
              style={{ marginBlockStart: 3 }}
            />
            <Text fontSize={12} type={'secondary'}>
              {t('goalEmpty.judge.bad')}
            </Text>
          </Flexbox>
          <Flexbox horizontal align={'flex-start'} gap={8}>
            <Icon
              color={cssVar.colorSuccess}
              icon={CheckIcon}
              size={13}
              style={{ marginBlockStart: 3 }}
            />
            <Text fontSize={12}>{t('goalEmpty.judge.good')}</Text>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </Block>
  );
});

GoalEmptyState.displayName = 'GoalEmptyState';

export default GoalEmptyState;
