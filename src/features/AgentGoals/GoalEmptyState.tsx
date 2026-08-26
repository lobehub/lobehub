'use client';

import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { TargetIcon } from 'lucide-react';
import {
  CalendarClockIcon,
  CheckIcon,
  CircleHelpIcon,
  InfinityIcon,
  Layers3Icon,
  PlusIcon,
  TablePropertiesIcon,
  XIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { GoalExampleKey, GoalExampleSeed } from './goalExamples';
import { buildGoalExampleSeed, GOAL_EXAMPLE_KEYS } from './goalExamples';
import { createGoalHowItWorksModal } from './GoalHowItWorksModal';

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
  exampleIconBox: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillQuaternary};
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
    display: flex;
    align-items: center;
    justify-content: center;

    width: 104px;
    height: 72px;

    color: ${cssVar.colorTextTertiary};
  `,
  heroInner: css`
    position: relative;
    z-index: 1;
  `,
  heroLead: css`
    max-width: 560px;
    line-height: 1.7;
  `,
  /* Doubled selectors on purpose: base-ui's text variant pins the colour through
     `&, &:hover, &:active`, so a single-class rule here loses the cascade and the
     hint renders at full text weight. */
  howHint: css`
    margin-inline-end: -8px;

    &&,
    &&:active {
      color: ${cssVar.colorTextTertiary};
    }

    &&:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  judge: css`
    padding-block: 10px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
  section: css`
    padding-block: 24px;
    padding-inline: 40px;
  `,
}));

const EXAMPLE_ICONS: Record<GoalExampleKey, typeof TargetIcon> = {
  backlog: TablePropertiesIcon,
  digest: CalendarClockIcon,
  metric: Layers3Icon,
};

interface GoalEmptyStateProps {
  onCreate: (seed?: GoalExampleSeed) => void;
}

/**
 * First-run empty state for the goal list.
 *
 * A goal only pays off if the user understands the bargain before making one:
 * it runs autonomously, judges itself each round, and spends budget doing it.
 * "Goals will appear here" taught none of that, so this screen carries the
 * concept (what a goal is) and three seeded examples that demonstrate what a
 * *judgeable* outcome reads like. The mechanism — what happens round after
 * round — is one level down, behind the hint sitting opposite the examples
 * heading, so the two things that actually start a goal stay above the fold.
 */
const GoalEmptyState = memo<GoalEmptyStateProps>(({ onCreate }) => {
  const { t } = useTranslation('chat');

  return (
    <Block padding={0} variant={'borderless'}>
      <Flexbox align={'center'} className={styles.hero}>
        <Flexbox align={'center'} className={styles.heroInner} gap={16}>
          <div className={styles.heroIcon}>
            <InfinityIcon aria-hidden size={64} strokeWidth={1.75} />
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

      <Flexbox className={styles.section} gap={12}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text fontSize={13} type={'secondary'} weight={600}>
            {t('goalEmpty.examplesTitle')}
          </Text>
          <Button
            className={styles.howHint}
            icon={CircleHelpIcon}
            size={'small'}
            type={'text'}
            onClick={() => createGoalHowItWorksModal()}
          >
            {t('goalEmpty.howHint')}
          </Button>
        </Flexbox>
        <div className={styles.exampleGrid}>
          {GOAL_EXAMPLE_KEYS.map((key) => {
            const seed = buildGoalExampleSeed(key, (localeKey) => t(localeKey as never));

            return (
              <Flexbox
                horizontal
                align={'center'}
                className={styles.example}
                gap={12}
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
                <div className={styles.exampleIconBox}>
                  <Icon icon={EXAMPLE_ICONS[key]} size={16} />
                </div>
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Text fontSize={11} type={'secondary'}>
                    {t(`goalEmpty.examples.${key}.tag` as never)}
                  </Text>
                  <Text ellipsis={{ rows: 2 }} fontSize={13} weight={500}>
                    {seed.title}
                  </Text>
                </Flexbox>
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
