'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Accordion, type AccordionItemType, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  clamp3: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '3',
  },
  feedback: { paddingBlock: '6px' },
  folded: {
    paddingBlockStart: '6px',
    paddingBlockEnd: '2px',
    fontSize: '12px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  },
  header: {
    paddingBlockStart: '4px',
    paddingBlockEnd: '10px',
    paddingInline: '0',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  label: { fontSize: '12px' },
  mark: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: '28px',
    blockSize: '28px',
    borderRadius: '6px',
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  pill: {
    flex: 'none',
    alignSelf: 'flex-start',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '18px',
  },
  pillNeutral: {
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  pillWarning: {
    color: cssVar.colorWarning,
    backgroundColor: cssVar.colorWarningBg,
    backgroundImage: 'none',
  },
  quote: {
    marginBlockStart: '4px',
    paddingInlineStart: '10px',
    borderInlineStartWidth: '2px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorder,
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorText,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  },
  root: {
    overflow: 'hidden',
    inlineSize: '100%',
    minInlineSize: 'min(320px, 100%)',
    fontSize: '13px',
    textAlign: 'start',
  },
  section: {
    paddingBlockStart: '8px',
    paddingBlockEnd: '2px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'solid', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  toggle: {
    cursor: 'pointer',
    margin: '0',
    paddingBlock: '0',
    paddingInlineStart: '12px',
    paddingInlineEnd: '0',
    borderStyle: 'none',
    font: 'inherit',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
});

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
    <div {...stylex.props(styles.feedback)}>
      <Flexbox horizontal align="baseline" gap={8}>
        {task ? (
          <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
            {task}
          </Text>
        ) : null}
        <Text
          className={stylex.props(styles.label).className}
          style={{ flex: 'none' }}
          type="secondary"
        >
          {meta}
        </Text>
      </Flexbox>
      <div {...stylex.props(styles.quote, long && !expanded && styles.clamp3)}>
        {feedback.body}
        {expanded && feedback.truncated ? '…' : null}
      </div>
      {long ? (
        <button
          aria-expanded={expanded}
          {...stylex.props(styles.toggle)}
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
                  <Text className={stylex.props(styles.label).className} type="secondary">
                    {t('goalTurn.omitted', { count: parsed.omitted.earlier })}
                  </Text>
                ) : null}
              </>
            ),
            key: 'earlier',
            title: (
              <Text className={stylex.props(styles.label).className} type="secondary">
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
              <div {...stylex.props(styles.folded)}>
                {parsed.requirement}
                {parsed.ownerInstruction ? `\n\n${parsed.ownerInstruction}` : ''}
              </div>
            ),
            key: 'requirement',
            title: (
              <Text className={stylex.props(styles.label).className} type="secondary">
                {t('goalTurn.requirement')}
              </Text>
            ),
          },
        ]
      : []),
    ...(parsed.instruction
      ? [
          {
            children: <div {...stylex.props(styles.folded)}>{parsed.instruction}</div>,
            key: 'instruction',
            title: (
              <Text className={stylex.props(styles.label).className} type="secondary">
                {t('goalTurn.instruction')}
              </Text>
            ),
          },
        ]
      : []),
  ];

  return (
    <div {...stylex.props(styles.root)}>
      <Flexbox horizontal align="center" className={stylex.props(styles.header).className} gap={10}>
        <span {...stylex.props(styles.mark)}>
          <Icon icon={TargetIcon} size={16} />
        </span>
        <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {t('goalTurn.title', { max: attrs.maxTurns ?? '?', turn: attrs.turn ?? '?' })}
          </Text>
          {/* The reason itself is the previous reply, right above this card. */}
          {previous ? (
            <Text ellipsis className={stylex.props(styles.label).className} type="secondary">
              {t(`goalTurn.outcome.${previous.outcome}` as any, {
                action: previous.action,
                defaultValue: previous.outcome,
              })}
            </Text>
          ) : null}
        </Flexbox>
        <span
          {...stylex.props(
            styles.pill,
            trigger === 'takeover' ? styles.pillWarning : styles.pillNeutral,
          )}
        >
          {t(`goalTurn.trigger.${trigger}` as any, { defaultValue: trigger })}
        </span>
      </Flexbox>

      {reason ? (
        <Flexbox className={stylex.props(styles.section).className} gap={4}>
          <Text className={stylex.props(styles.label).className} type="secondary">
            {t(parsed.problem ? 'goalTurn.problem' : 'goalTurn.continuation')}
          </Text>
          <div {...stylex.props(styles.quote)}>{reason}</div>
        </Flexbox>
      ) : null}

      {fresh.length > 0 || parsed.omitted.new > 0 ? (
        <div {...stylex.props(styles.section)}>
          <Text className={stylex.props(styles.label).className} type="secondary">
            {t('goalTurn.newFeedback', { count: fresh.length + parsed.omitted.new })}
          </Text>
          {fresh.map((feedback, index) => (
            <FeedbackRow feedback={feedback} key={`${feedback.taskId}-${index}`} />
          ))}
          {parsed.omitted.new > 0 ? (
            <Text className={stylex.props(styles.label).className} type="secondary">
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
