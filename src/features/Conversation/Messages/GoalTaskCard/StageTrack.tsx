'use client';

import { createStaticStyles, cssVar, cx, Flexbox, Text } from '@lobehub/ui';
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

const styles = createStaticStyles(({ css }) => ({
  connector: css`
    flex: 1;
    min-width: 12px;
    height: 1px;
    background: ${cssVar.colorBorder};
  `,
  connectorDone: css`
    background: ${cssVar.colorSuccessBorder};
  `,
  dot: css`
    flex: none;

    box-sizing: border-box;
    width: 8px;
    height: 8px;
    border: 1px solid ${cssVar.colorTextQuaternary};
    border-radius: 50%;
  `,
  dotCurrent: css`
    width: 10px;
    height: 10px;
    border-width: 2px;
    background: ${cssVar.colorBgElevated};
  `,
  dotDone: css`
    border-color: ${cssVar.colorSuccess};
    background: ${cssVar.colorSuccess};
  `,
}));

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
              <div className={cx(styles.connector, index <= current && styles.connectorDone)} />
            )}
            <Flexbox horizontal align={'center'} gap={6} style={{ flex: 'none' }}>
              <span
                className={cx(styles.dot, done && styles.dotDone, isCurrent && styles.dotCurrent)}
                style={isCurrent ? { borderColor: TONE_COLOR[tone] } : undefined}
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
