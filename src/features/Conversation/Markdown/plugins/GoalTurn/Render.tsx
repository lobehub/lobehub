'use client';

import { createStaticStyles, cx, Flexbox, Icon } from '@lobehub/ui';
import { Accordion, type AccordionItemType, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { TargetIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type MarkdownElementProps } from '../type';
import {
  type GoalTurnAttributes,
  type GoalTurnFeedback,
  type ParsedGoalTurn,
  parseGoalTurn,
} from './parseGoalTurn';

const styles = createStaticStyles(({ css, cssVar }) => ({
  /* The chat bubble folds tall messages, so a long comment is clamped and the
     new feedback stays in the first view. */
  clamp3: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  `,
  feedback: css`
    padding-block: 6px;
  `,
  folded: css`
    padding-block: 6px 2px;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  header: css`
    padding-block: 4px 10px;
    padding-inline: 0;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  label: css`
    font-size: 12px;
  `,
  mark: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    inline-size: 28px;
    block-size: 28px;
    border-radius: 6px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};
  `,
  pill: css`
    flex: none;
    align-self: flex-start;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    font-weight: 500;
    line-height: 18px;
  `,
  pillNeutral: css`
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorFillSecondary};
  `,
  pillWarning: css`
    color: ${cssVar.colorWarning};
    background: ${cssVar.colorWarningBg};
  `,
  quote: css`
    margin-block-start: 4px;
    padding-inline-start: 10px;
    border-inline-start: 2px solid ${cssVar.colorBorder};

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  root: css`
    overflow: hidden;

    inline-size: 100%;

    /* The goal supervision panel is narrower than 320px of bubble content;
       a fixed minimum pushed the trigger pill past the bubble's edge. */
    min-inline-size: min(320px, 100%);

    font-size: 13px;
    text-align: start;
  `,
  section: css`
    padding-block: 8px 2px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  toggle: css`
    cursor: pointer;

    margin: 0;
    padding-block: 0;
    padding-inline: 12px 0;
    border: none;

    font: inherit;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));

/** Rough line count past which a body is clamped and gets its own toggle. */
const isLong = (text: string) => text.length > 120 || text.split('\n').length > 3;

/**
 * One comment, named by the task it was left on — the title, never the id the
 * agent works with — then who wrote it and when, then the comment as a quote.
 */
const FeedbackRow = ({ feedback }: { feedback: GoalTurnFeedback }) => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const long = isLong(feedback.body);
  const author = feedback.author === 'user' ? t('goalTurn.authorUser') : feedback.author;
  const meta = [author, feedback.updatedAt && dayjs(feedback.updatedAt).format('MM-DD HH:mm')]
    .filter(Boolean)
    .join(' · ');
  const task = feedback.taskTitle || feedback.taskId;

  return (
    <div className={styles.feedback}>
      <Flexbox horizontal align="baseline" gap={8}>
        {task ? (
          <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
            {task}
          </Text>
        ) : null}
        <Text className={styles.label} style={{ flex: 'none' }} type="secondary">
          {meta}
        </Text>
      </Flexbox>
      <div className={cx(styles.quote, long && !expanded && styles.clamp3)}>
        {feedback.body}
        {expanded && feedback.truncated ? '…' : null}
      </div>
      {long ? (
        <button
          aria-expanded={expanded}
          className={styles.toggle}
          type="button"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('goalTurn.showLess') : t('goalTurn.showAll')}
        </button>
      ) : null}
    </div>
  );
};

/**
 * The message the goal manager sends its planning agent each turn, rendered as
 * a card: which turn, why it started and how the previous one ended in the
 * header, then the review feedback new since then. Sections with nothing to say
 * are not drawn. The requirement, earlier feedback and the agent's standing
 * instructions repeat every turn, so they start folded.
 */
const Render = ({ children, node }: MarkdownElementProps<GoalTurnAttributes>) => {
  const { t } = useTranslation('chat');
  const attrs = node?.properties ?? ({} as GoalTurnAttributes);
  const text = typeof children === 'string' ? children : String(children ?? '');
  const parsed = useMemo<ParsedGoalTurn>(() => parseGoalTurn(text), [text]);

  const fresh = parsed.feedback.filter((f) => f.isNew);
  const earlier = parsed.feedback.filter((f) => !f.isNew);
  const trigger = attrs.trigger ?? 'settled';
  const previous = parsed.previousTurn;
  const reason = parsed.problem ?? parsed.continuation;

  // What repeats every turn or runs long starts folded, behind the shared
  // disclosure so it is reachable from the keyboard and announced as such.
  const folds: AccordionItemType[] = [
    ...(earlier.length > 0 || parsed.omitted.earlier > 0
      ? [
          {
            children: (
              <>
                {earlier.map((feedback, index) => (
                  <FeedbackRow feedback={feedback} key={`${feedback.taskId}-${index}`} />
                ))}
                {parsed.omitted.earlier > 0 ? (
                  <Text className={styles.label} type="secondary">
                    {t('goalTurn.omitted', { count: parsed.omitted.earlier })}
                  </Text>
                ) : null}
              </>
            ),
            key: 'earlier',
            title: (
              <Text className={styles.label} type="secondary">
                {t('goalTurn.earlierFeedback', { count: earlier.length + parsed.omitted.earlier })}
              </Text>
            ),
          },
        ]
      : []),
    ...(parsed.requirement
      ? [
          {
            children: (
              <div className={styles.folded}>
                {parsed.requirement}
                {parsed.ownerInstruction ? `\n\n${parsed.ownerInstruction}` : ''}
              </div>
            ),
            key: 'requirement',
            title: (
              <Text className={styles.label} type="secondary">
                {t('goalTurn.requirement')}
              </Text>
            ),
          },
        ]
      : []),
    ...(parsed.instruction
      ? [
          {
            children: <div className={styles.folded}>{parsed.instruction}</div>,
            key: 'instruction',
            title: (
              <Text className={styles.label} type="secondary">
                {t('goalTurn.instruction')}
              </Text>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className={styles.root}>
      <Flexbox horizontal align="center" className={styles.header} gap={10}>
        <span className={styles.mark}>
          <Icon icon={TargetIcon} size={16} />
        </span>
        <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {t('goalTurn.title', { max: attrs.maxTurns ?? '?', turn: attrs.turn ?? '?' })}
          </Text>
          {/* The reason itself is the previous reply, right above this card. */}
          {previous ? (
            <Text ellipsis className={styles.label} type="secondary">
              {t(`goalTurn.outcome.${previous.outcome}` as any, {
                action: previous.action,
                defaultValue: previous.outcome,
              })}
            </Text>
          ) : null}
        </Flexbox>
        <span
          className={cx(
            styles.pill,
            trigger === 'takeover' ? styles.pillWarning : styles.pillNeutral,
          )}
        >
          {t(`goalTurn.trigger.${trigger}` as any, { defaultValue: trigger })}
        </span>
      </Flexbox>

      {reason ? (
        <Flexbox className={styles.section} gap={4}>
          <Text className={styles.label} type="secondary">
            {t(parsed.problem ? 'goalTurn.problem' : 'goalTurn.continuation')}
          </Text>
          <div className={styles.quote}>{reason}</div>
        </Flexbox>
      ) : null}

      {fresh.length > 0 || parsed.omitted.new > 0 ? (
        <div className={styles.section}>
          <Text className={styles.label} type="secondary">
            {t('goalTurn.newFeedback', { count: fresh.length + parsed.omitted.new })}
          </Text>
          {fresh.map((feedback, index) => (
            <FeedbackRow feedback={feedback} key={`${feedback.taskId}-${index}`} />
          ))}
          {parsed.omitted.new > 0 ? (
            <Text className={styles.label} type="secondary">
              {t('goalTurn.omitted', { count: parsed.omitted.new })}
            </Text>
          ) : null}
        </div>
      ) : null}

      {folds.length > 0 ? (
        <Accordion
          multiple
          indicatorPlacement={'end'}
          items={folds}
          // The borderless header pulls itself 8px left; the inline padding puts the
          // titles back on the card's text edge, inside its overflow clip.
          styles={{ trigger: { paddingBlock: 6, paddingInline: 8 } }}
          variant={'borderless'}
        />
      ) : null}
    </div>
  );
};

export default Render;
