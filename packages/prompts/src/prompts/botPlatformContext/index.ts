/**
 * Compact cross-session history from the same IM channel, pre-injected for
 * platforms that can't read chat history at runtime (e.g. WeChat). Topics are
 * most-recent-first; user messages are oldest-first.
 */
export interface RecentChannelHistory {
  /** Recent topic titles from the same channel, most-recent first. */
  topics: string[];
  /** The last few user messages across those topics, oldest-first. */
  userMessages: string[];
}

export interface BotPlatformInfo {
  /**
   * Whether the platform can read chat history at runtime via `readMessages`.
   * When false (e.g. WeChat), the AI is not told to call `readMessages`, and any
   * `recentChannelHistory` is what it must rely on for prior context. Defaults
   * to true.
   */
  canReadHistory?: boolean;
  platformName: string;
  /** Pre-injected recent same-channel history (cross-session). */
  recentChannelHistory?: RecentChannelHistory;
  supportsMarkdown: boolean;
  /** Non-fatal warnings from message processing (e.g. file too large, parse failure) */
  warnings?: string[];
}

/**
 * Format bot platform context into a system-level instruction.
 *
 * Always tells the AI which platform it's running on so it can adapt its behavior.
 * When the platform does not support Markdown, instructs the AI to use plain text only.
 */
export const formatBotPlatformContext = ({
  canReadHistory = true,
  platformName,
  recentChannelHistory,
  supportsMarkdown,
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
    // `recent_channel_history` block below — telling them to call a tool that
    // isn't in their manifest just wastes a turn and ends in an apology.
    ...(canReadHistory
      ? [
          '- When the user\'s message references prior context you don\'t have (e.g. "what do you think?", "summarize this", "look at that"), use `readMessages` IMMEDIATELY to fetch recent chat history before responding. Never ask the user to repeat what was already said in the channel.',
          '- When you lack enough context to give a useful answer, silently read more history rather than asking clarifying questions — the answer is usually already in the chat.',
        ]
      : [
          '- When the user references prior context you don\'t have, use the `recent_channel_history` below (if present). This platform has no history-read API, so do NOT claim you "can\'t read history" — work from what you have and ask a brief clarifying question only if the history block is absent or insufficient.',
        ]),
    '- Keep responses concise and conversational — IM platforms have character limits and small viewports. Avoid long preambles or formal structure unless the question demands it.',
    '- Do NOT reference UI elements from other environments (e.g. "check the sidebar", "click the button above").',
    '</behavior>',
    '',
    '<message_delivery>',
    'Your text response is AUTOMATICALLY delivered to the current conversation — the runtime pipeline handles it.',
    'Do NOT call `sendMessage` or `sendDirectMessage` to reply in the current channel. Just respond with text directly.',
    '`sendMessage` / `sendDirectMessage` should ONLY be used when the user explicitly asks you to send a message to a DIFFERENT channel or user.',
    '</message_delivery>',
  ];

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

  // Sanitize user-controlled text before embedding it in the XML-ish prompt, so
  // titles / message bodies containing tags or quotes can't break out or inject.
  const sanitize = (text: string) =>
    text.replaceAll(
      /[<>&"']/g,
      (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[ch]!,
    );

  const recentTopics = recentChannelHistory?.topics?.filter((t) => t?.trim()) ?? [];
  const recentUserMessages = recentChannelHistory?.userMessages?.filter((m) => m?.trim()) ?? [];
  if (recentTopics.length > 0 || recentUserMessages.length > 0) {
    lines.push(
      '',
      '<recent_channel_history>',
      'Summary of THIS conversation from earlier sessions (not the current message). Use it for continuity; do not treat it as the current turn.',
    );
    if (recentTopics.length > 0) {
      lines.push(
        '',
        'Recent topics (most recent first):',
        ...recentTopics.map((t, i) => `${i + 1}. ${sanitize(t)}`),
      );
    }
    if (recentUserMessages.length > 0) {
      lines.push(
        '',
        'Recent messages from the user (oldest first):',
        ...recentUserMessages.map((m) => `- ${sanitize(m)}`),
      );
    }
    lines.push('</recent_channel_history>');
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
