import { BOT_NO_REPLY_REASONS, BOT_NO_REPLY_TOKEN } from '@lobechat/types';

/** Who else took part lately, and how sure the addressed check was (0..1). */
export interface OptionalReplyFollowup {
  participants?: { isBot?: boolean; isOwner?: boolean; name: string }[];
  score?: number;
}

export interface OptionalReplyContext {
  /** The message falls within the agent's duties; `helpful`: it can settle an open question. */
  duty?: { helpful?: boolean; matched?: string };
  /** The agent spoke here lately and the message came after. */
  followup?: OptionalReplyFollowup;
  /** The agent's name is in the text, with no @-mention or reply. */
  named?: boolean;
  /**
   * The surrounding prompt has a `<self_improvement>` section the agent saves feedback with.
   * Without one the hints only ask it to acknowledge the feedback.
   */
  selfImprovement?: boolean;
  /** The agent may stand down from the conversation (`STAND_DOWN`). */
  standDown?: boolean;
}

const SELF_IMPROVEMENT_CLAUSE =
  ', and save what you will do differently as <self_improvement> describes';

/**
 * Sanitize user-controlled text before embedding it in the XML-ish prompt, so
 * titles / message bodies / channel ids containing tags or quotes can't break
 * out or inject.
 */
const sanitize = (text: string) =>
  text.replaceAll(
    /[<>&"']/g,
    (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

type FollowupParticipant = NonNullable<OptionalReplyFollowup['participants']>[number];

const describeParticipant = ({ isBot, isOwner, name }: FollowupParticipant) =>
  `${sanitize(name)}${isOwner ? ' (your owner)' : isBot ? ' (a bot)' : ''}`;

/** Why a follow-up-window wake happened, and the rule for a thread with several participants. */
const followupHint = (
  { participants = [], score }: OptionalReplyFollowup,
  selfImprovement: boolean,
) =>
  [
    'Why you were woken: you spoke in this conversation a little while ago and this message came after. Nobody @-mentioned you, replied to you or said your name',
    score === undefined
      ? '.'
      : `; a quick check was ${Math.round(score * 100)}% sure the message is meant for you.`,
    participants.length > 0
      ? ` Also taking part lately: ${participants.map(describeParticipant).join(', ')}.`
      : '',
    ` You are one participant among several, not the one everyone is talking to, and being woken is not a request to answer. Judge for yourself, the way a teammate who just spoke would: does this conversation need a reply from you right now? Reply when it does: the message is meant for you, or what you have to say changes something for the people here. If the message is addressed to someone else, only acknowledges you, or others are leading the discussion and it goes on fine without you, end with \`${BOT_NO_REPLY_TOKEN}:not_addressed\`. When unsure, stay silent. If someone is unhappy with something you did, that is for you: acknowledge it plainly, without defending yourself${selfImprovement ? SELF_IMPROVEMENT_CLAUSE : ''}.`,
  ].join('');

/**
 * What an agent woken by the conversation rather than addressed is told: it may stay silent
 * with `NO_REPLY`, and why it woke. Shared by IM bots and Channel; see {@link formatOptionalReply}
 * for the tagged block.
 */
export const formatOptionalReplyBody = ({
  duty,
  followup,
  named,
  selfImprovement = true,
  standDown,
}: OptionalReplyContext): string[] => {
  const selfImprovementClause = selfImprovement ? SELF_IMPROVEMENT_CLAUSE : '';

  return [
    'You were woken by the conversation itself, not by someone addressing you directly. Speaking is optional.',
    `If you have nothing worth adding — the message is not for you, is off topic, repeats something already answered, or was already handled — end your turn with exactly \`${BOT_NO_REPLY_TOKEN}\` and no other text.`,
    `You may append a reason: \`${BOT_NO_REPLY_TOKEN}:<reason>\`, where reason is one of ${BOT_NO_REPLY_REASONS.filter((r) => r !== 'empty_completion' && (standDown || r !== 'stand_down')).join(', ')}.`,
    'Stay silent rather than posting filler. If you do have something useful to say, just reply normally.',
    `Announcing that you will stay out ("I'll leave this one to you", "这条我不接") is itself a reply and interrupts just the same: when you decide not to take part, end with \`${BOT_NO_REPLY_TOKEN}\` instead of saying so.`,
    ...(followup ? [followupHint(followup, selfImprovement)] : []),
    ...(named
      ? [
          `Why you were woken: your name appears in the message, but nobody @-mentioned you or replied to you. People often talk about you rather than to you: commenting on what you did, joking, or asking each other why you spoke up. Decide the way a teammate in the room would: speak when the message asks you to do or answer something, or when you have something the conversation actually needs; let a passing remark or a joke about you go by and end with \`${BOT_NO_REPLY_TOKEN}:not_addressed\`. When someone is unhappy with something you did (you replied when you should not have, got it wrong, were too noisy), do respond: acknowledge it plainly, without defending yourself${selfImprovementClause}. Say it once, briefly, then keep to it: do not apologise again or announce that you are staying out.${standDown ? ' If they say you are interfering or should stay out, stand down (see <stand_down>).' : ''}`,
        ]
      : []),
    ...(duty?.helpful
      ? [
          `Why you were woken: nobody addressed you and the message is not one of your duties, but it leaves something open (a question, an undecided choice, a problem someone just noticed) that nobody has settled, and you may be able to settle it with something concrete you can check or do: code, data, the state of a task or PR, your own earlier output. Read the conversation first. Speak only if you can give that concrete answer, briefly, the way a teammate who looked it up would. If someone already answered it or is handling it, end with \`${BOT_NO_REPLY_TOKEN}:already_handled\`; if it is a question for a particular person, or all you could add is a general opinion, end with \`${BOT_NO_REPLY_TOKEN}:not_addressed\`.`,
        ]
      : duty
        ? [
            `Why you were woken: nobody addressed you, but the message falls within the duties your owner gave you${duty.matched?.trim() ? ` (the duty: "${sanitize(duty.matched.trim())}")` : ''}. Read the conversation first. If the duty applies, carry it out the way a teammate holding it would: do the work it describes, and say what you did or will do. If on a closer look it does not apply, end with \`${BOT_NO_REPLY_TOKEN}:off_topic\`; if someone is already handling it, with \`${BOT_NO_REPLY_TOKEN}:already_handled\`.`,
          ]
        : []),
  ];
};

/** {@link formatOptionalReplyBody} as an `<optional_reply>` block, one line per entry. */
export const formatOptionalReply = (context: OptionalReplyContext): string[] => [
  '<optional_reply>',
  ...formatOptionalReplyBody(context),
  '</optional_reply>',
];
