'use client';

import { OptionCard } from '@lobechat/shared-tool-ui/components';
import type { TaskIntentAnalysis } from '@lobechat/types';
import type { IEditor } from '@lobehub/editor';
import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import { ActionIcon, Button, Tabs, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft, Check, ListChecks, Paperclip, Sparkles, Target } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorCanvas } from '@/features/EditorCanvas';
import { pickAndInsertAttachments } from '@/features/EditorCanvas/editorAttachments';

import type { ClarificationAnswers } from './taskIntent';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;

    /* Roomier than the question steps need: the confirm step also carries the
       instruction editor, and clamping it lower buried the answers recap. */
    max-height: 420px;
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
  // Mirrors OptionCard's own index chip so the free-text row reads as one more
  // numbered choice rather than a separate control below the list.
  customIndex: css`
    flex-shrink: 0;

    box-sizing: border-box;
    width: 22px;
    height: 22px;
    border-radius: 6px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;

    background: ${cssVar.colorFillTertiary};
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
  customRow: css`
    margin-block-start: 2px;

    /* Align the chip under OptionCard's own index chips. */
    padding-inline: 12px;
  `,
  instruction: css`
    overflow-y: auto;
    max-height: 220px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  tabs: css`
    [role='tablist'] {
      width: 100%;
    }
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
  answers: ClarificationAnswers;
  /** Editor the confirmed instruction is read back from. Owned by the composer. */
  instructionEditor?: IEditor;
  /** Bumped when a new reading arrives, so the editor reloads its seed. */
  instructionRevision: number;
  /** What the instruction editor opens with: markdown plus its rich-text mirror. */
  instructionSeed: { content: string; editorData: unknown };
  isCreating?: boolean;
  onAnswerChange: (index: number, value: string) => void;
  onBack: () => void;
  onConfirm: () => void;
  /** Omitted when goals are unavailable — the exit is then simply not offered. */
  onSwitchToGoal?: () => void;
  onTitleChange: (title: string) => void;
  title: string;
}

/**
 * The confirmation step between typing a task and creating it.
 *
 * It only ever renders for a draft the reader could not settle on its own, so
 * everything here is something the user is the only one able to answer. The
 * questions stay optional: skipping them creates exactly the task the composer
 * would have created before, which keeps the step a checkpoint rather than a
 * form to fill in.
 */
const TaskIntentReview = memo<TaskIntentReviewProps>((props) => {
  const {
    analysis,
    answers,
    instructionEditor,
    instructionRevision,
    instructionSeed,
    isCreating,
    onAnswerChange,
    onBack,
    onConfirm,
    onSwitchToGoal,
    onTitleChange,
    title,
  } = props;
  const { t } = useTranslation('chat');

  // One question at a time, exactly like AskUserQuestionView: stacking them all
  // in a scroll box hid both that a next question existed and how to reach it.
  const [activeIndex, setActiveIndex] = useState(0);
  const clarifications = analysis.clarifications;
  // A new reading is a new set of questions, so the cursor goes back to the top
  // rather than pointing past the end of a shorter list.
  useEffect(() => setActiveIndex(0), [clarifications]);

  const isAnswered = useCallback((index: number) => Boolean(answers[index]?.trim()), [answers]);

  // One past the last question: the step that says what answering produced.
  const confirmIndex = clarifications.length;

  const pickOption = useCallback(
    (index: number, option: string) => {
      // Tapping the option that is already the answer clears it, so a mis-tap
      // doesn't force the user to select the text and delete it by hand.
      const cleared = answers[index] === option;
      onAnswerChange(index, cleared ? '' : option);
      if (cleared) return;

      // Sweep to the next still-unanswered question, and when there is none
      // left, to the confirm step — answering the last question has to lead
      // somewhere, or the form just sits on it with nothing having happened.
      const next = clarifications.findIndex((_, i) => i !== index && !answers[i]?.trim());
      setActiveIndex(next >= 0 ? next : clarifications.length);
    },
    [answers, clarifications, onAnswerChange],
  );

  const showGoalExit = analysis.kind === 'goal' && Boolean(onSwitchToGoal);
  const onConfirmStep = activeIndex >= confirmIndex;
  const active = clarifications[activeIndex];

  // The primary button is the only thing telling the user where they are, so it
  // names the step it is on: advancing through the questions, then confirming.
  // Leaving it as "Create task" throughout made every step look like the last
  // one — pressing it on Q1 created the task and the confirm step was
  // unreachable in practice.
  const primary = onConfirmStep
    ? {
        action: onConfirm,
        label: t(clarifications.length > 0 ? 'taskIntent.confirmCreate' : 'taskIntent.confirm'),
      }
    : { action: () => setActiveIndex(activeIndex + 1), label: t('taskIntent.next') };

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

        {clarifications.length > 0 && (
          <Tabs
            activeKey={String(activeIndex)}
            className={styles.tabs}
            variant={'square'}
            items={[
              ...clarifications.map((_, index) => ({
                key: String(index),
                label: (
                  <Flexbox horizontal align={'center'} gap={6}>
                    <Text>{`Q${index + 1}`}</Text>
                    {isAnswered(index) && <Icon icon={Check} size={12} />}
                  </Flexbox>
                ),
              })),
              {
                key: String(confirmIndex),
                label: (
                  <Flexbox horizontal align={'center'} gap={6}>
                    <Icon icon={ListChecks} size={12} />
                    <Text>{t('taskIntent.confirmStep')}</Text>
                  </Flexbox>
                ),
              },
            ]}
            onChange={(key) => setActiveIndex(Number(key))}
          />
        )}

        {/* The instruction belongs to the step that says what will be created.
            Showing it beside a question would compete with answering it, and
            the answers are folded in only once the user confirms. */}
        {onConfirmStep && (
          <Flexbox gap={8}>
            <Flexbox horizontal align={'center'} justify={'space-between'}>
              <Text fontSize={12} type={'secondary'}>
                {t('taskIntent.instructionLabel')}
              </Text>
              <ActionIcon
                icon={Paperclip}
                size={'small'}
                title={t('upload.action.tooltip')}
                onClick={() => pickAndInsertAttachments(instructionEditor)}
              />
            </Flexbox>
            <Flexbox className={styles.instruction}>
              <EditorCanvas
                contentRevision={instructionRevision}
                editor={instructionEditor}
                editorData={instructionSeed}
                entityId={'task-intent-review'}
                floatingToolbar={false}
                placeholder={t('createTask.instructionPlaceholder')}
                style={{ fontSize: 13, padding: '8px 12px' }}
              />
            </Flexbox>
          </Flexbox>
        )}

        {onConfirmStep && clarifications.length > 0 && (
          <Flexbox gap={10}>
            <Text fontSize={12} type={'secondary'}>
              {t('taskIntent.confirmHeading')}
            </Text>
            <Flexbox gap={4}>
              {clarifications.map((clarification, index) => {
                const answer = answers[index]?.trim();
                return (
                  // Each row is also the way back: reviewing an answer and
                  // changing it should not require hunting for its tab.
                  <Flexbox
                    className={styles.answerRow}
                    gap={2}
                    key={clarification.question}
                    onClick={() => setActiveIndex(index)}
                  >
                    <Text fontSize={12} type={'secondary'}>
                      {clarification.question}
                    </Text>
                    {answer ? (
                      <Text>{answer}</Text>
                    ) : (
                      // Skipping is allowed, but it must be visible: an
                      // unanswered question is never written into the brief.
                      <Text fontSize={13} type={'secondary'}>
                        {t('taskIntent.skipped')}
                      </Text>
                    )}
                  </Flexbox>
                );
              })}
            </Flexbox>
          </Flexbox>
        )}

        {active &&
          !onConfirmStep &&
          (() => {
            const index = activeIndex;
            const options = active.options ?? [];
            // An answer that isn't one of the offered options is the user's own
            // wording, so it belongs in the free-text row rather than leaving
            // every card unselected with the text stranded elsewhere.
            const picked = options.includes(answers[index] ?? '') ? answers[index] : undefined;
            const custom = picked === undefined ? (answers[index] ?? '') : '';

            return (
              <Flexbox gap={10} key={active.question}>
                <Flexbox gap={2}>
                  <Text strong>{active.question}</Text>
                  {active.impact && (
                    <Text fontSize={12} type={'secondary'}>
                      {active.impact}
                    </Text>
                  )}
                </Flexbox>

                <Flexbox gap={4} role={'listbox'}>
                  {options.map((option, optionIndex) => (
                    <OptionCard
                      index={optionIndex + 1}
                      key={option}
                      label={option}
                      selected={picked === option}
                      onToggle={() => pickOption(index, option)}
                    />
                  ))}
                  <Flexbox horizontal align={'center'} className={styles.customRow} gap={12}>
                    <span className={styles.customIndex}>{options.length + 1}</span>
                    <TextArea
                      autoSize={{ maxRows: 4, minRows: 1 }}
                      placeholder={t('taskIntent.answerPlaceholder')}
                      style={{ flex: 1 }}
                      value={custom}
                      variant={'filled'}
                      onChange={(e) => onAnswerChange(index, e.target.value)}
                    />
                  </Flexbox>
                </Flexbox>
              </Flexbox>
            );
          })()}
      </Flexbox>

      <Flexbox horizontal align={'center'} className={styles.footer} justify={'space-between'}>
        <Button icon={ArrowLeft} size={'small'} type={'text'} onClick={onBack}>
          {t('taskIntent.back')}
        </Button>
        <Button
          disabled={isCreating}
          loading={isCreating}
          shape={'round'}
          size={'small'}
          type={'primary'}
          onClick={primary.action}
        >
          {primary.label}
        </Button>
      </Flexbox>
    </>
  );
});

export default TaskIntentReview;
