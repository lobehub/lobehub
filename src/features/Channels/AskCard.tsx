import type {
  ChannelAsk,
  ChannelAskAnswerItem,
  ChannelAskQuestion,
  ChannelDetail,
  ChannelPublicMessage,
} from '@lobechat/types';
import { CHANNEL_ASK_LIMITS } from '@lobechat/types';
import { Button, Icon, Input, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { channelActions } from '@/store/channel';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { isCurrentUserMember, memberName } from './memberName';

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    width: '100%',
    maxWidth: 560,
    paddingBlock: 16,
    paddingInline: 16,
    borderRadius: 16,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  question: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  option: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    width: '100%',
    marginBlock: 0,
    marginInline: 0,
    paddingBlock: 6,
    paddingInline: 6,
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: 10,
    font: 'inherit',
    color: cssVar.colorText,
    textAlign: 'start',
    backgroundColor: {
      'default': 'transparent',
      ':hover': cssVar.colorFillTertiary,
    },
    cursor: 'pointer',
  },
  optionStatic: {
    backgroundColor: 'transparent',
    cursor: 'default',
  },
  optionPicked: {
    backgroundColor: cssVar.colorFillSecondary,
  },
  optionFaded: {
    opacity: 0.45,
  },
  letter: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
  },
  letterPicked: {
    color: cssVar.colorBgContainer,
    backgroundColor: cssVar.colorText,
  },
  label: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    minWidth: 0,
  },
  footer: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});

const letterOf = (index: number) => String.fromCodePoint(65 + index);

interface Draft {
  other: string;
  otherOpen: boolean;
  selected: string[];
}

const emptyDraft = (): Draft => ({ other: '', otherOpen: false, selected: [] });

const toAnswer = ({ other, otherOpen, selected }: Draft): ChannelAskAnswerItem => ({
  selected,
  ...(otherOpen && other.trim() && { other: other.trim() }),
});

const answered = (draft: Draft) =>
  draft.selected.length > 0 || (draft.otherOpen && !!draft.other.trim());

const OptionRow = ({
  description,
  faded,
  index,
  label,
  onClick,
  picked,
}: {
  description?: string;
  faded?: boolean;
  index: number;
  label: string;
  onClick?: () => void;
  picked: boolean;
}) => (
  <button
    aria-pressed={onClick ? picked : undefined}
    disabled={!onClick}
    type="button"
    onClick={onClick}
    {...stylex.props(
      styles.option,
      !onClick && styles.optionStatic,
      picked && styles.optionPicked,
      faded && styles.optionFaded,
    )}
  >
    <span {...stylex.props(styles.letter, picked && styles.letterPicked)}>
      {picked ? <Icon icon={Check} size={14} /> : letterOf(index)}
    </span>
    <span {...stylex.props(styles.label)}>
      <span>{label}</span>
      {description && (
        <Text fontSize={12} type="secondary">
          {description}
        </Text>
      )}
    </span>
  </button>
);

const QuestionBlock = ({
  answer,
  draft,
  onChange,
  onPick,
  question,
}: {
  /** Set once answered: shows what was picked, read-only. */
  answer?: ChannelAskAnswerItem;
  /** Set while the viewer may answer. */
  draft?: Draft;
  onChange?: (draft: Draft) => void;
  /** A single-choice pick that completes the whole card. */
  onPick?: (label: string) => void;
  question: ChannelAskQuestion;
}) => {
  const { t } = useTranslation('channel');
  const interactive = !!draft && !!onChange;
  const otherIndex = question.options.length;
  const otherPicked = answer ? !!answer.other : !!draft?.otherOpen;

  const toggle = (label: string) => {
    if (!draft || !onChange) return;
    if (!question.multiSelect) {
      if (onPick) return onPick(label);
      return onChange({ ...draft, otherOpen: false, selected: [label] });
    }
    const selected = draft.selected.includes(label)
      ? draft.selected.filter((value) => value !== label)
      : [...draft.selected, label];
    onChange({ ...draft, selected });
  };

  return (
    <div {...stylex.props(styles.question)}>
      {question.header && (
        <Text fontSize={12} type="secondary">
          {question.header}
        </Text>
      )}
      <Text strong>{question.question}</Text>
      {question.multiSelect && interactive && (
        <Text fontSize={12} type="secondary">
          {t('ask.multiSelect')}
        </Text>
      )}
      {question.options.map((option, index) => {
        const picked = answer
          ? answer.selected.includes(option.label)
          : !!draft?.selected.includes(option.label);
        return (
          <OptionRow
            description={option.description}
            faded={!!answer && !picked}
            index={index}
            key={option.label}
            label={option.label}
            picked={picked}
            onClick={interactive ? () => toggle(option.label) : undefined}
          />
        );
      })}
      {(interactive || answer?.other) && (
        <OptionRow
          faded={!!answer && !otherPicked}
          index={otherIndex}
          label={answer?.other ?? t('ask.other')}
          picked={otherPicked}
          onClick={
            interactive
              ? () =>
                  onChange!({
                    ...draft!,
                    otherOpen: !draft!.otherOpen,
                    selected: question.multiSelect ? draft!.selected : [],
                  })
              : undefined
          }
        />
      )}
      {interactive && draft!.otherOpen && (
        <Input
          autoFocus
          maxLength={CHANNEL_ASK_LIMITS.otherLength}
          placeholder={t('ask.otherPlaceholder')}
          value={draft!.other}
          onChange={(event) => onChange!({ ...draft!, other: event.target.value })}
        />
      )}
    </div>
  );
};

/**
 * An Agent's question with options. Its requester answers with a tap (or their own words under
 * "Other"); the answer posts as their reply and wakes the Agent. Everyone else, and everyone
 * once it is answered, sees it read-only.
 */
export const AskCard = ({
  ask,
  detail,
  message,
}: {
  ask: ChannelAsk;
  detail: ChannelDetail;
  message: ChannelPublicMessage;
}) => {
  const { t } = useTranslation('channel');
  const userId = useUserStore(userProfileSelectors.userId);
  const requester = detail.members.find((member) => member.id === ask.requesterMemberId);
  const canAnswer =
    ask.status === 'pending' &&
    !message.deletedAt &&
    !!requester &&
    isCurrentUserMember(requester, userId);
  const [drafts, setDrafts] = useState<Draft[]>(() => ask.questions.map(emptyDraft));
  const [submitting, setSubmitting] = useState(false);

  const submit = async (answers: ChannelAskAnswerItem[]) => {
    setSubmitting(true);
    try {
      await channelActions.answerAsk({
        answers,
        channelId: detail.channel.id,
        messageId: message.id,
        // One answer per question: a retry of the same answer returns what it posted.
        requestKey: `ask-answer:${message.id}`,
        threadId: message.threadId,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('ask.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  // One single-choice question needs no confirm step: the tap is the answer.
  const instant = ask.questions.length === 1 && !ask.questions[0].multiSelect;
  const complete = drafts.every(answered);

  return (
    <div {...stylex.props(styles.card)}>
      {ask.questions.map((question, index) => (
        <QuestionBlock
          answer={ask.status === 'answered' ? ask.answer?.answers[index] : undefined}
          draft={canAnswer && !submitting ? drafts[index] : undefined}
          key={index}
          question={question}
          onPick={instant ? (label) => submit([{ selected: [label] }]) : undefined}
          onChange={(draft) =>
            setDrafts((current) => current.map((item, at) => (at === index ? draft : item)))
          }
        />
      ))}
      {canAnswer && (!instant || drafts[0].otherOpen) && (
        <div {...stylex.props(styles.footer)}>
          <span />
          <Button
            disabled={!complete}
            loading={submitting}
            type="primary"
            onClick={() => submit(drafts.map(toAnswer))}
          >
            {t('ask.submit')}
          </Button>
        </div>
      )}
      {!canAnswer && (
        <Text fontSize={12} type="secondary">
          {ask.status === 'answered'
            ? t('ask.answeredBy', {
                name: memberName(
                  detail.members.find((member) => member.id === ask.answer?.memberId),
                  t('deletedMember'),
                ),
              })
            : ask.status === 'closed'
              ? t('ask.closed')
              : t('ask.waitingFor', { name: memberName(requester, t('deletedMember')) })}
        </Text>
      )}
    </div>
  );
};
