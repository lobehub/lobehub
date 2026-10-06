'use client';

import type { TaskIntentAnalysis } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft, Sparkles, Target } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ClarificationQuestions, {
  type ClarificationAnswer,
  type ClarificationQuestion,
} from '@/features/ClarificationQuestions';

import type { ClarificationAnswers } from './taskIntent';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;

    /* Viewport-relative, because the footer holds the only way forward: a fixed
       cap sized for a tall window pushed "create" below the fold on a short one,
       leaving the panel's primary action unreachable without scrolling. The
       question list scrolls inside this box instead, and the footer stays put.
       (The absolute cap is the leftover from the confirm step's instruction
        editor, which no longer exists — the questions never needed it.) */
    max-height: min(420px, 42dvh);
    padding-block: 12px 16px;
    padding-inline: 16px;
  `,
  footer: css`
    padding-block: 8px;
    padding-inline: 8px 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  goalCallout: css`
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  head: css`
    padding-block: 12px 0;
    padding-inline: 16px;
  `,
  // Reuses OptionCard's row rhythm so the recap reads as the same list the
  // user just answered, not as a different kind of object.
  answerRow: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 8px;

    transition: background 0.12s ease;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  instruction: css`
    overflow-y: auto;
    max-height: 220px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  title: css`
    box-sizing: border-box;
    width: 100%;
    padding-block: 2px;
    border: none;

    font-family: inherit;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.4;
    color: inherit;

    background: transparent;
    outline: none;
  `,
}));

export interface TaskIntentReviewProps {
  analysis: TaskIntentAnalysis;
  /** True while the brief is being written and the task created. */
  isCreating?: boolean;
  /** Mirrors the answers given so far, keyed by clarification index. */
  onAnswersChange: (answers: ClarificationAnswers) => void;
  onBack: () => void;
  /** `answers` is what the form just submitted; without it, the mirrored answers are used. */
  onConfirm: (answers?: ClarificationAnswers) => void;
  /** Create without answering: exactly the task the composer would have created. */
  onSkip: () => void;
  /** Omitted when goals are unavailable — the exit is then simply not offered. */
  onSwitchToGoal?: () => void;
  onTitleChange: (title: string) => void;
  title: string;
}

/** A picked option is its own label; a note from the notes box rides along. */
const toIndexedAnswers = (answers: ClarificationAnswer[]): ClarificationAnswers =>
  Object.fromEntries(
    answers.map((answer) => [
      Number(answer.questionId),
      answer.type === 'text'
        ? answer.text
        : answer.note
          ? `${answer.optionId} (${answer.note})`
          : answer.optionId,
    ]),
  );

/**
 * The confirmation step between typing a task and creating it.
 *
 * It only ever renders for a draft the reader could not settle on its own, so
 * everything here is something the user is the only one able to answer. The
 * questions are asked with the same form agents and goals use, and stay
 * optional: skipping them creates exactly the task the composer would have
 * created before, which keeps this a checkpoint rather than a form to fill in.
 */
const TaskIntentReview = memo<TaskIntentReviewProps>((props) => {
  const {
    analysis,
    isCreating,
    onAnswersChange,
    onBack,
    onConfirm,
    onSkip,
    onSwitchToGoal,
    onTitleChange,
    title,
  } = props;
  const { t } = useTranslation('chat');
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);

  const clarifications = analysis.clarifications;
  const questions = useMemo<ClarificationQuestion[]>(
    () =>
      clarifications.map((clarification, index) => ({
        description: clarification.impact,
        header: '',
        id: String(index),
        options: (clarification.options ?? []).map((option) => ({ id: option, label: option })),
        question: clarification.question,
      })),
    [clarifications],
  );
  const handleAnswersChange = useCallback(
    (answers: ClarificationAnswer[]) => onAnswersChange(toIndexedAnswers(answers)),
    [onAnswersChange],
  );

  const showGoalExit = analysis.kind === 'goal' && Boolean(onSwitchToGoal);
  const hasQuestions = questions.length > 0;

  return (
    <>
      <Flexbox className={styles.head} gap={6}>
        <Flexbox horizontal align={'center'} gap={6}>
          <Icon color={cssVar.colorTextDescription} icon={Sparkles} size={13} />
          <Text fontSize={12} type={'secondary'}>
            {t('taskIntent.reviewStep')}
          </Text>
        </Flexbox>
        <input
          className={styles.title}
          placeholder={t('createTask.titlePlaceholder')}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
        />
      </Flexbox>

      <Flexbox className={styles.body} gap={16}>
        <Text fontSize={13} type={'secondary'}>
          {analysis.summary}
        </Text>

        {showGoalExit && (
          <Flexbox horizontal align={'center'} className={styles.goalCallout} gap={12}>
            <Icon color={cssVar.colorTextSecondary} icon={Target} size={16} />
            <Flexbox flex={1} gap={2}>
              <Text fontSize={13} weight={500}>
                {t('taskIntent.goalCallout.title')}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                {analysis.kindReason || t('taskIntent.goalCallout.desc')}
              </Text>
            </Flexbox>
            <Button size={'small'} type={'fill'} onClick={onSwitchToGoal}>
              {t('taskIntent.goalCallout.action')}
            </Button>
          </Flexbox>
        )}

        {hasQuestions && (
          <ClarificationQuestions
            actionsPortalTarget={actionsTarget}
            key={analysis.summary}
            questions={questions}
            requireAllAnswered={false}
            skipLabel={t('taskIntent.skipQuestions')}
            submitLabel={t('taskIntent.create')}
            onAnswersChange={handleAnswersChange}
            onSkip={onSkip}
            // Hand over what was submitted: a keyboard pick submits in the same
            // event that mirrors it, before the parent's state has caught up.
            onSubmit={(answers) => onConfirm(toIndexedAnswers(answers))}
          />
        )}
      </Flexbox>

      <Flexbox horizontal align={'center'} className={styles.footer} justify={'space-between'}>
        <Button icon={ArrowLeft} size={'small'} type={'text'} onClick={onBack}>
          {t('taskIntent.back')}
        </Button>
        {hasQuestions ? (
          // The form's own Skip / Create land here, so the step keeps one footer.
          <div ref={setActionsTarget} />
        ) : (
          <Button
            disabled={isCreating}
            loading={isCreating}
            shape={'round'}
            size={'small'}
            type={'primary'}
            onClick={() => onConfirm()}
          >
            {t('taskIntent.create')}
          </Button>
        )}
      </Flexbox>
    </>
  );
});

export default TaskIntentReview;
