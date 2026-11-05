'use client';

import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  example: {
    cursor: 'pointer',
    paddingBlock: '12px',
    paddingInline: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorPrimaryBorder },
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    transition: `all 0.15s ${cssVar.motionEaseOut}`,
  },
  exampleIconBox: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  exampleGrid: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'repeat(3, minmax(0, 1fr))',
      '@media (width <= 860px)': 'minmax(0, 1fr)',
    },
    gap: '10px',
  },
  hero: {
    isolation: 'isolate',
    position: 'relative',
    overflow: 'hidden',
    paddingBlockStart: '40px',
    paddingBlockEnd: '32px',
    paddingInline: '40px',
    textAlign: 'center',
  },
  heroIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '104px',
    height: '72px',
    color: cssVar.colorTextTertiary,
  },
  heroInner: { position: 'relative', zIndex: 1 },
  heroLead: { maxWidth: '560px', lineHeight: 1.7 },
  // base-ui's text variant pins the colour through `&, &:hover, &:active`; the
  // hint restates all three so it stays muted instead of full text weight.
  howHint: {
    marginInlineEnd: '-8px',
    color: {
      'default': cssVar.colorTextTertiary,
      ':hover': cssVar.colorTextSecondary,
      ':active': cssVar.colorTextTertiary,
    },
  },
  judge: {
    paddingBlock: '10px',
    paddingInline: '14px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  section: { paddingBlock: '24px', paddingInline: '40px' },
});

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
      <Flexbox align={'center'} className={stylex.props(styles.hero).className}>
        <Flexbox align={'center'} className={stylex.props(styles.heroInner).className} gap={16}>
          <div {...stylex.props(styles.heroIcon)}>
            <InfinityIcon aria-hidden size={64} strokeWidth={1.75} />
          </div>
          <Flexbox align={'center'} gap={8}>
            <Text fontSize={20} weight={600}>
              {t('goalEmpty.title')}
            </Text>
            <Text
              className={stylex.props(styles.heroLead).className}
              fontSize={14}
              type={'secondary'}
            >
              {t('goalEmpty.lead')}
            </Text>
          </Flexbox>
          <Button icon={PlusIcon} type={'primary'} onClick={() => onCreate()}>
            {t('goalEmpty.create')}
          </Button>
        </Flexbox>
      </Flexbox>

      <Flexbox className={stylex.props(styles.section).className} gap={12}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Text fontSize={13} type={'secondary'} weight={600}>
            {t('goalEmpty.examplesTitle')}
          </Text>
          <Button
            className={stylex.props(styles.howHint).className}
            icon={CircleHelpIcon}
            size={'small'}
            type={'text'}
            onClick={() => createGoalHowItWorksModal()}
          >
            {t('goalEmpty.howHint')}
          </Button>
        </Flexbox>
        <div {...stylex.props(styles.exampleGrid)}>
          {GOAL_EXAMPLE_KEYS.map((key) => {
            const seed = buildGoalExampleSeed(key, (localeKey) => t(localeKey as never));

            return (
              <Flexbox
                horizontal
                align={'center'}
                className={stylex.props(styles.example).className}
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
                <div {...stylex.props(styles.exampleIconBox)}>
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

        <Flexbox className={stylex.props(styles.judge).className} gap={6}>
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
