import type { BotWakeKind } from '@lobechat/types';
import {
  BOT_NO_REPLY_REASONS,
  BOT_NO_REPLY_TOKEN,
  BOT_STAND_DOWN_MINUTES,
  BOT_STAND_DOWN_TOKEN,
} from '@lobechat/types';

/** One prior topic (session) from the same IM channel. */
export interface RecentChannelTopic {
  /** Topic creation time as a UTC ISO-8601 string. */
  createdAt?: string;
  /** Topic description / summary, if any. */
  description?: string;
  /** Topic id — lets the model fetch the full transcript via `lh topic view <id>`. */
  id: string;
  /** The last user message in this topic (pre-truncated upstream). */
  lastUserMessage?: string;
  name: string;
}

/**
 * Compact cross-session history from the same IM channel, pre-injected for
 * platforms that can't read chat history at runtime (e.g. WeChat). Topics are
 * most-recent-first.
 */
export interface RecentChannelHistory {
  /** Recent topics from the same channel, most-recent first. */
  topics: RecentChannelTopic[];
}

/**
 * Identity of the conversation the bot is currently replying in, expressed in
 * the exact terms the `lobe-message` tool takes.
 *
 * Without this the model holds a `readMessages` tool whose `channelId` is a
 * required parameter it has no way to fill: most platforms have no
 * `listChannels` to discover it with, so it ends up asking the user to paste a
 * chat ID (the Feishu "你方便拿一下群 ID 吗" case).
 */
export interface CurrentBotChannel {
  /** Channel / chat / conversation id, as `readMessages.channelId` expects it. */
  id: string;
  /** Platform id for the tool's `platform` enum (e.g. `lark`, not `Lark`). */
  platformId: string;
}

export interface BotPlatformInfo {
  /**
   * Whether the platform can read chat history at runtime via `readMessages`.
   * When false (e.g. WeChat), the AI is not told to call `readMessages`, and any
   * `recentChannelHistory` is what it must rely on for prior context. Defaults
   * to true.
   */
  canReadHistory?: boolean;
  /** Identifiers of the conversation this run is replying in. */
  currentChannel?: CurrentBotChannel;
  /**
   * The bot woke on its own because a message nobody addressed to it falls within its duties (a
   * `followup` wake). `matched` names the duty, when the judgement said which. `helpful`: it woke
   * instead because stepping in would help, an open question nobody settled. The agent is told
   * why, so it acts or stays silent.
   */
  duty?: { helpful?: boolean; matched?: string };
  /**
   * The bot woke because it spoke in this conversation lately and the message came after (a
   * `followup` wake), not because anyone addressed it. `score` is how sure the addressed check was
   * (0..1); `participants` who else took part lately, by name. The agent is told it is one
   * participant among several.
   */
  followup?: {
    participants?: { isBot?: boolean; isOwner?: boolean; name: string }[];
    score?: number;
  };
  /**
   * The bot woke only because its name is in the text, with no @-mention or reply (a `followup`
   * wake). The agent is told people often talk about it rather than to it.
   */
  named?: boolean;
  /**
   * The short acknowledgement already posted to the user before this run started ("Got it, I'll
   * check the logs first"). The agent continues from it instead of acknowledging again.
   */
  openingReply?: string;
  platformName: string;
  /** Pre-injected recent same-channel history (cross-session). */
  recentChannelHistory?: RecentChannelHistory;
  /**
   * Emoji and stickers the owner lets the bot use, pasted as written (`<:doge:123>`, `:doge:`, 🐶),
   * each with when it fits.
   */
  replyEmojis?: { emoji: string; usage?: string }[];
  /** How the bot talks in this conversation, as the owner wrote it (the channel's or the default). */
  replyStyle?: string;
  /**
   * The agent may step back from this conversation when people say it is interfering: it ends its
   * reply with `STAND_DOWN`, and for a while only an @-mention or a reply wakes it here.
   */
  standDown?: boolean;
  supportsMarkdown: boolean;
  /**
   * How the bot was woken. On `followup` the agent is told it may stay silent; on `mention` (or
   * when omitted) it must answer, so the prompt is unchanged.
   */
  wakeKind?: BotWakeKind;
  /** Non-fatal warnings from message processing (e.g. file too large, parse failure) */
  warnings?: string[];
}

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

type FollowupParticipant = NonNullable<
  NonNullable<BotPlatformInfo['followup']>['participants']
>[number];

const describeParticipant = ({ isBot, isOwner, name }: FollowupParticipant) =>
  `${sanitize(name)}${isOwner ? ' (your owner)' : isBot ? ' (a bot)' : ''}`;

/** Why a follow-up-window wake happened, and the rule for a thread with several participants. */
const followupHint = ({ participants = [], score }: NonNullable<BotPlatformInfo['followup']>) =>
  [
    'Why you were woken: you spoke in this conversation a little while ago and this message came after. Nobody @-mentioned you, replied to you or said your name',
    score === undefined
      ? '.'
      : `; a quick check was ${Math.round(score * 100)}% sure the message is meant for you.`,
    participants.length > 0
      ? ` Also taking part lately: ${participants.map(describeParticipant).join(', ')}.`
      : '',
    ` You are one participant among several, not the one everyone is talking to, and being woken is not a request to answer. Judge for yourself, the way a teammate who just spoke would: does this conversation need a reply from you right now? Reply when it does: the message is meant for you, or what you have to say changes something for the people here. If the message is addressed to someone else, only acknowledges you, or others are leading the discussion and it goes on fine without you, end with \`${BOT_NO_REPLY_TOKEN}:not_addressed\`. When unsure, stay silent. If someone is unhappy with something you did, that is for you: acknowledge it plainly, without defending yourself, and save what you will do differently as <self_improvement> describes.`,
  ].join('');

/**
 * Format bot platform context into a system-level instruction.
 *
 * Always tells the AI which platform it's running on so it can adapt its behavior.
 * When the platform does not support Markdown, instructs the AI to use plain text only.
 */
export const formatBotPlatformContext = ({
  canReadHistory = true,
  currentChannel,
  duty,
  followup,
  named,
  openingReply,
  platformName,
  recentChannelHistory,
  replyEmojis,
  replyStyle,
  standDown,
  supportsMarkdown,
  wakeKind,
  warnings,
}: BotPlatformInfo): string => {
  const lines = [
    `<bot_platform_context platform="${platformName}">`,
    `You are a participant in a **${platformName}** conversation — not an external assistant being consulted.`,
    '',
    '<behavior>',
    '- Act like a knowledgeable group member: respond naturally, stay on topic, and match the conversational tone.',
    // On platforms that can read history, tell the model to fetch it on demand.
    // Platforms without a history-read API (e.g. WeChat) instead get the
    // `recent_topics` block below — telling them to call a tool that
    // isn't in their manifest just wastes a turn and ends in an apology.
    ...(canReadHistory
      ? [
          '- When the user\'s message references prior context you don\'t have (e.g. "what do you think?", "summarize this", "look at that"), use `readMessages` IMMEDIATELY to fetch recent chat history before responding. Never ask the user to repeat what was already said in the channel.',
          '- When you lack enough context to give a useful answer, silently read more history rather than asking clarifying questions — the answer is usually already in the chat.',
        ]
      : [
          '- When the user references prior context you don\'t have, use the `recent_topics` below (if present). This platform has no history-read API, so do NOT claim you "can\'t read history" — work from what you have and ask a brief clarifying question only if the topics block is absent or insufficient.',
        ]),
    '- Keep responses concise and conversational — IM platforms have character limits and small viewports. Avoid long preambles or formal structure unless the question demands it.',
    '- Do NOT reference UI elements from other environments (e.g. "check the sidebar", "click the button above").',
    '</behavior>',
    '',
    // A bot run ends with the reply, so "next time I'll…" said in chat is gone
    // by the next wake. Anyone who can wake the bot may steer it; the runtime
    // still keeps bot settings to the owner (`updateBot` refuses others).
    '<self_improvement>',
    'When someone here tells you how to do better — corrects a mistake, says what to do next time, or gives a standing rule — make the change durable in this same turn. A promise only said in chat ("next time I will…") is lost when this run ends.',
    'Pick where it goes by what the lesson is (activate the tool first if it is not loaded):',
    "- When you should step in, in this channel → your bot duties (`botWakeDuties`): `lobe-message` getBotDetail → updateBot. Only the bot's owner may change bot settings; if updateBot refuses, put the rule in your system prompt instead.",
    '- How you talk here (tone, length, emoji) → your bot reply style: `replyStyle` for every channel, `channelReplyStyles` for one channel, `replyEmojis` for the emoji you may use; same tools and owner rule as the duties.',
    '- How you work, wherever you are asked → your system prompt: `lobe-agent-management` getAgentDetail → updatePrompt, with your own id from `current_agent`.',
    '- A multi-step procedure or checklist you will reuse → `lobe-agent-documents` createDocument with hintIsSkill=true.',
    '- Facts, references or a longer spec → `lobe-agent-documents` createDocument; when it must be read before some task, also say so in your system prompt.',
    'Read the current content first and edit in place: keep everything you did not mean to change, and do not add a rule that is already there.',
    'Then say in one line what you changed and where. If nothing could be saved (no tool, or it refused), say the lesson was not saved — never claim you will remember it.',
    '</self_improvement>',
    '',
    '<message_delivery>',
    'Your text response is AUTOMATICALLY delivered to the current conversation — the runtime pipeline handles it.',
    'Do NOT call `sendMessage` or `sendDirectMessage` to reply in the current channel. Just respond with text directly.',
    // Text replies cannot carry files, so delivering a generated file into this
    // conversation is the one legitimate `sendMessage` here. Without a route
    // hint the model runs `<outbound_routing>` discovery and may pick another
    // bot on the same platform — one with an expired session.
    'Exception — files: your text reply cannot carry attachments. To deliver a file / image / video / audio into THIS conversation, call `sendMessage` with `attachments` for the current conversation and pass NEITHER `botId` NOR `messengerInstallationId`: the runtime sends it through the same connection this conversation arrived on. Do not run `listBots` / `listMessengers` for this.',
    '`sendMessage` / `sendDirectMessage` should otherwise ONLY be used when the user explicitly asks you to send a message to a DIFFERENT channel or user.',
    '</message_delivery>',
  ];

  // The identifiers of the conversation we're standing in. `readMessages` takes
  // `channelId` as a REQUIRED parameter, and most platforms have no
  // `listChannels` for the model to discover it with — without this block it
  // can only ask the user to paste a chat ID, which is exactly the failure this
  // exists to prevent. Rendered whenever we know the channel, including on
  // platforms without history-read (the id still serves reactions / channel info).
  if (currentChannel?.id) {
    lines.push(
      '',
      `<current_conversation platform="${sanitize(currentChannel.platformId)}" channelId="${sanitize(currentChannel.id)}">`,
      'These are the EXACT argument values for any `lobe-message` call that targets the conversation you are currently in:',
      `- \`platform\`: "${sanitize(currentChannel.platformId)}"`,
      `- \`channelId\`: "${sanitize(currentChannel.id)}"`,
      '',
      ...(canReadHistory
        ? [
            'You already have everything `readMessages` needs. Call it with these two values the moment you need prior context.',
          ]
        : []),
      'NEVER ask the user for a chat / channel / group ID, and never call `listChannels` to look up the current one — it is right here.',
      'When a `lobe-message` send targets this conversation, omit `botId` / `messengerInstallationId` — the runtime already knows which connection this conversation uses.',
      '</current_conversation>',
    );
  }

  if (openingReply?.trim()) {
    lines.push(
      '',
      '<opening_reply>',
      'You already posted this acknowledgement to the user, before starting:',
      `"${sanitize(openingReply.trim())}"`,
      'Do not acknowledge again or repeat it. Do the work it announced and reply with the result.',
      '</opening_reply>',
    );
  }

  if (wakeKind === 'followup') {
    lines.push(
      '',
      '<optional_reply>',
      'You were woken by the conversation itself, not by someone addressing you directly. Speaking is optional.',
      `If you have nothing worth adding — the message is not for you, is off topic, repeats something already answered, or was already handled — end your turn with exactly \`${BOT_NO_REPLY_TOKEN}\` and no other text.`,
      `You may append a reason: \`${BOT_NO_REPLY_TOKEN}:<reason>\`, where reason is one of ${BOT_NO_REPLY_REASONS.filter((r) => r !== 'empty_completion' && (standDown || r !== 'stand_down')).join(', ')}.`,
      'Stay silent rather than posting filler. If you do have something useful to say, just reply normally.',
      `Announcing that you will stay out ("I'll leave this one to you", "这条我不接") is itself a reply and interrupts just the same: when you decide not to take part, end with \`${BOT_NO_REPLY_TOKEN}\` instead of saying so.`,
      ...(followup ? [followupHint(followup)] : []),
      ...(named
        ? [
            `Why you were woken: your name appears in the message, but nobody @-mentioned you or replied to you. People often talk about you rather than to you: commenting on what you did, joking, or asking each other why you spoke up. Decide the way a teammate in the room would: speak when the message asks you to do or answer something, or when you have something the conversation actually needs; let a passing remark or a joke about you go by and end with \`${BOT_NO_REPLY_TOKEN}:not_addressed\`. When someone is unhappy with something you did (you replied when you should not have, got it wrong, were too noisy), do respond: acknowledge it plainly, without defending yourself, and save what you will do differently as <self_improvement> describes. Say it once, briefly, then keep to it: do not apologise again or announce that you are staying out.${standDown ? ' If they say you are interfering or should stay out, stand down (see <stand_down>).' : ''}`,
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
      '</optional_reply>',
    );
  }

  // Owner-written; only the tag characters are escaped so the text cannot close the block.
  const style = replyStyle?.trim().replaceAll('<', '‹').replaceAll('>', '›');
  if (style) {
    lines.push(
      '',
      '<reply_style>',
      'How you talk in this conversation, as your owner wrote it. It shapes your tone and form, not what you do or whether you reply; where it conflicts with the platform rules below, the platform rules win.',
      style,
      '</reply_style>',
    );
  }

  // Pasted verbatim: a custom emoji code (`<:doge:123>`) only renders unescaped. One line each.
  const emojis = (replyEmojis ?? []).filter(({ emoji }) => emoji.trim() && !/[\n\r`]/.test(emoji));
  if (emojis.length > 0) {
    lines.push(
      '',
      '<reply_emojis>',
      'Emoji and stickers you may use, one per line: write the code before the dash exactly as listed, without backticks around it. Use one when it fits the moment, the way people in this chat do; most replies need none, and never more than one or two. Do not write any other custom emoji code: one not on this list shows as broken text.',
      ...emojis.map(({ emoji, usage }) =>
        usage?.trim()
          ? `- ${emoji.trim()} — ${usage.trim().replaceAll(/\s+/g, ' ')}`
          : `- ${emoji.trim()}`,
      ),
      '</reply_emojis>',
    );
  }

  if (standDown) {
    lines.push(
      '',
      '<stand_down>',
      `If people here tell you that you are interfering, talking over them, or should stay out of this conversation, step back: acknowledge it once, in one short sentence, and end your reply with a last line that is exactly \`${BOT_STAND_DOWN_TOKEN}\`. That line is not posted.`,
      `For the next ${BOT_STAND_DOWN_MINUTES} minutes you are then woken here only when someone @-mentions you or replies to one of your messages. Do not stand down to dodge a question someone asked you.`,
      ...(wakeKind === 'followup'
        ? [
            `To step back without posting anything, end with \`${BOT_NO_REPLY_TOKEN}:stand_down\` instead.`,
          ]
        : []),
      '</stand_down>',
    );
  }

  if (!supportsMarkdown) {
    lines.push(
      '',
      '<formatting>',
      'This platform does NOT support Markdown rendering.',
      'You MUST NOT use any Markdown formatting in your response, including:',
      '- **bold**, *italic*, ~~strikethrough~~',
      '- `inline code` or ```code blocks```',
      '- # Headings',
      '- [links](url)',
      '- Tables, blockquotes, or HTML tags',
      '',
      'Use plain text only. Use line breaks, indentation, dashes, and numbering to structure your response for readability.',
      '</formatting>',
    );
  }

  const recentTopics = recentChannelHistory?.topics?.filter((t) => t?.id) ?? [];
  if (recentTopics.length > 0) {
    lines.push(
      '',
      '<recent_topics>',
      'Prior sessions from THIS channel (most recent first). Use them for continuity; do not treat them as the current turn.',
      'To read the full conversation of a topic, run `lh topic view <topic-id>` with the `id` below.',
    );
    for (const topic of recentTopics) {
      const attrs = [
        `id="${sanitize(topic.id)}"`,
        `name="${sanitize(topic.name)}"`,
        topic.createdAt ? `createdAt="${sanitize(topic.createdAt)}"` : undefined,
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(
        '',
        `<topic ${attrs}>`,
        ...(topic.description?.trim() ? [sanitize(topic.description.trim())] : []),
        ...(topic.lastUserMessage?.trim()
          ? [`<last_user_message>${sanitize(topic.lastUserMessage.trim())}</last_user_message>`]
          : []),
        '</topic>',
      );
    }
    lines.push('</recent_topics>');
  }

  if (warnings && warnings.length > 0) {
    lines.push(
      '',
      '<processing_warnings>',
      "The following issues occurred while processing the user's message.",
      'Briefly inform the user about these issues in your response:',
      ...warnings.map((w) => `- ${sanitize(w)}`),
      '</processing_warnings>',
    );
  }

  lines.push('</bot_platform_context>');

  return lines.join('\n');
};
