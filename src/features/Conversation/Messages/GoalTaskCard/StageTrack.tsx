'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { GOAL_CARD_STAGES, type GoalCardStage, type GoalCardTone } from './goalCardModel';

const TONE_COLOR: Record<GoalCardTone, string> = {
  active: cssVar.colorInfo,
  canceled: cssVar.colorTextQuaternary,
  error: cssVar.colorError,
  paused: cssVar.colorTextTertiary,
  waiting: cssVar.colorWarning,
};

const styles = stylex.create({
  connector: {
    flex: '1',
    minWidth: '12px',
    height: '1px',
    backgroundColor: cssVar.colorBorder,
    backgroundImage: 'none',
  },
  connectorDone: { backgroundColor: cssVar.colorSuccessBorder, backgroundImage: 'none' },
  dot: {
    flex: 'none',
    boxSizing: 'border-box',
    width: '8px',
    height: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorTextQuaternary,
    borderRadius: '50%',
  },
  dotCurrent: {
    width: '10px',
    height: '10px',
    borderWidth: '2px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  dotDone: {
    borderColor: cssVar.colorSuccess,
    backgroundColor: cssVar.colorSuccess,
    backgroundImage: 'none',
  },
});

/**
 * The goal's big stages as one left-to-right track — where it stands in the
 * plan → execute → accept → achieve arc, with the current stage colored by
 * whether it is moving, paused, waiting on the user, or stopped.
 */
const StageTrack = memo<{ stage: GoalCardStage; tone: GoalCardTone }>(({ stage, tone }) => {
  const { t } = useTranslation('chat');
  const current = GOAL_CARD_STAGES.indexOf(stage);

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      {GOAL_CARD_STAGES.map((key, index) => {
        const done = stage === 'achieved' || index < current;
        const isCurrent = !done && index === current;

        return (
          <Fragment key={key}>
            {index > 0 && (
              <div {...stylex.props(styles.connector, index <= current && styles.connectorDone)} />
            )}
            <Flexbox horizontal align={'center'} gap={6} style={{ flex: 'none' }}>
              <span
                style={isCurrent ? { borderColor: TONE_COLOR[tone] } : undefined}
                className={
                  stylex.props(styles.dot, done && styles.dotDone, isCurrent && styles.dotCurrent)
                    .className
                }
              />
              <Text
                fontSize={12}
                weight={isCurrent ? 500 : undefined}
                style={{
                  color: isCurrent
                    ? cssVar.colorText
                    : done
                      ? cssVar.colorTextSecondary
                      : cssVar.colorTextTertiary,
                }}
              >
                {t(`goalTask.stage.${key}`)}
              </Text>
            </Flexbox>
          </Fragment>
        );
      })}
    </Flexbox>
  );
});

StageTrack.displayName = 'GoalStageTrack';

export default StageTrack;
