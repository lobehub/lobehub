'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import dayjs from 'dayjs';
import { ChevronRightIcon, MessageSquareTextIcon, TargetIcon } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type MarkdownElementProps } from '../type';
import {
  type GoalTurnAttributes,
  type GoalTurnFeedback,
  type ParsedGoalTurn,
  parseGoalTurn,
} from './parseGoalTurn';

const styles = createStaticStyles(({ css, cssVar }) => ({
  feedback: css`
    padding-block: 8px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  /* The chat bubble folds tall messages, so long text here is clamped and the
     new feedback stays in the first view. */
  clamp2: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  `,
  clamp4: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
  `,
  feedbackBody: css`
    padding-inline-start: 24px;

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;
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
  meta: css`
    font-size: 12px;
  `,
  pill: css`
    flex: none;

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
  root: css`
    overflow: hidden;

    inline-size: 100%;

    /* The goal supervision panel is narrower than 320px of bubble content;
       a fixed minimum pushed the trigger pill past the bubble's edge. */
    min-inline-size: min(320px, 100%);

    font-size: 13px;
    text-align: start;
  `,
  row: css`
    padding-block: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
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
    user-select: none;

    display: inline-flex;
    gap: 2px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  toggleOpen: css`
    svg {
      transform: rotate(90deg);
    }
  `,
}));

/** A labelled section that starts folded; for what repeats every turn or is long. */
const Fold = ({ children, label }: { children: ReactNode; label: ReactNode }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.section}>
      <span
        className={cx(styles.toggle, open && styles.toggleOpen)}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <Icon icon={ChevronRightIcon} size={12} />
      </span>
      {open ? <div className={styles.folded}>{children}</div> : null}
    </div>
  );
};

/** Rough line count past which a body is clamped and gets its own toggle. */
const isLong = (text: string) => text.length > 160 || text.split('\n').length > 4;

const FeedbackRow = ({ feedback }: { feedback: GoalTurnFeedback }) => {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const long = isLong(feedback.body);
  const author = feedback.author === 'user' ? t('goalTurn.authorUser') : feedback.author;
  const meta = [
    feedback.taskId,
    feedback.updatedAt ? dayjs(feedback.updatedAt).format('MM-DD HH:mm') : undefined,
    feedback.truncated ? t('goalTurn.truncated') : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Flexbox className={styles.feedback} gap={4}>
      <Flexbox horizontal align="center" gap={8}>
        <Icon icon={MessageSquareTextIcon} size="small" style={{ flex: 'none', opacity: 0.6 }} />
        <Text style={{ flex: 'none' }} weight={500}>
          {author}
        </Text>
        {meta ? (
          <Text className={styles.meta} style={{ minWidth: 0 }} type="secondary">
            {meta}
          </Text>
        ) : null}
      </Flexbox>
      <div className={cx(styles.feedbackBody, long && !expanded && styles.clamp4)}>
        {feedback.body}
      </div>
      {long ? (
        <span
          className={styles.toggle}
          style={{ paddingInlineStart: 24 }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('goalTurn.showLess') : t('goalTurn.showAll')}
        </span>
      ) : null}
    </Flexbox>
  );
};

/**
 * The message the goal manager sends its planning agent each turn, rendered as
 * a card: which turn and why it started, how the previous turn ended, and the
 * review feedback new since then. The requirement, earlier feedback and the
 * agent's standing instructions repeat every turn, so they start folded.
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

  return (
    <div className={styles.root}>
      <Flexbox horizontal align="center" className={styles.header} gap={10}>
        <span className={styles.mark}>
          <Icon icon={TargetIcon} size={16} />
        </span>
        <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
          {t('goalTurn.title', { max: attrs.maxTurns ?? '?', turn: attrs.turn ?? '?' })}
        </Text>
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
        <Flexbox className={styles.row} gap={4}>
          <Text className={styles.meta} type="secondary">
            {t(parsed.problem ? 'goalTurn.problem' : 'goalTurn.continuation')}
          </Text>
          <Text style={{ whiteSpace: 'pre-wrap' }}>{reason}</Text>
        </Flexbox>
      ) : null}

      {previous ? (
        <Flexbox className={styles.row} gap={2}>
          <Text className={styles.meta} type="secondary">
            {t('goalTurn.previousLabel')}
          </Text>
          <div className={styles.clamp2} title={previous.reason}>
            <Text weight={500}>
              {t(`goalTurn.outcome.${previous.outcome}` as any, {
                action: previous.action,
                defaultValue: previous.outcome,
              })}
            </Text>
            {previous.reason ? <Text type="secondary">{` — ${previous.reason}`}</Text> : null}
          </div>
        </Flexbox>
      ) : null}

      <div className={styles.row}>
        <Text className={styles.meta} type="secondary">
          {fresh.length > 0
            ? t('goalTurn.newFeedback', { count: fresh.length })
            : t('goalTurn.noNewFeedback')}
        </Text>
        {fresh.map((feedback, index) => (
          <FeedbackRow feedback={feedback} key={`${feedback.taskId}-${index}`} />
        ))}
        {parsed.omitted.new > 0 ? (
          <Text className={styles.meta} type="secondary">
            {t('goalTurn.omitted', { count: parsed.omitted.new })}
          </Text>
        ) : null}
      </div>

      {earlier.length > 0 || parsed.omitted.earlier > 0 ? (
        <Fold
          label={t('goalTurn.earlierFeedback', {
            count: earlier.length + parsed.omitted.earlier,
          })}
        >
          {earlier.map((feedback, index) => (
            <FeedbackRow feedback={feedback} key={`${feedback.taskId}-${index}`} />
          ))}
          {parsed.omitted.earlier > 0
            ? t('goalTurn.omitted', { count: parsed.omitted.earlier })
            : null}
        </Fold>
      ) : null}

      {parsed.requirement ? (
        <Fold label={t('goalTurn.requirement')}>
          {parsed.requirement}
          {parsed.ownerInstruction ? `\n\n${parsed.ownerInstruction}` : ''}
        </Fold>
      ) : null}

      {parsed.instruction ? (
        <Fold label={t('goalTurn.instruction')}>{parsed.instruction}</Fold>
      ) : null}
    </div>
  );
};

export default Render;
