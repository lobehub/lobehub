/** Minimal message shape required for feedback-context rendering. */
export interface FeedbackContextMessage {
  content?: string | null;
  id?: string;
  role: string;
}

/** Inputs required to render one feedback-analysis XML document. */
export interface RenderMessageContextParams {
  feedbackMessage: FeedbackContextMessage;
  latestAssistantReply?: FeedbackContextMessage;
  recentMessages: FeedbackContextMessage[];
}

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const toXmlAttribute = (name: string, value?: string) => {
  if (!value) return '';

  return ` ${name}="${escapeXml(value)}"`;
};

const toNormalizedContent = (value?: string | null) => value?.trim() ?? '';

const renderMessageElement = (message: FeedbackContextMessage) => {
  const content = escapeXml(toNormalizedContent(message.content));

  return [
    `<message${toXmlAttribute('id', message.id)}${toXmlAttribute('role', message.role)}>`,
    `<content>${content}</content>`,
    `</message>`,
  ].join('');
};

/**
 * Renders feedback-analysis context into a deterministic XML envelope.
 *
 * Use when:
 * - Later feedback stages need the recent conversation in one stable string
 * - Tests need a pure serializer without database dependencies
 *
 * Expects:
 * - `recentMessages` is already ordered from oldest to newest
 * - `latestAssistantReply`, when present, already reflects the most recent assistant turn
 *
 * Returns:
 * - One stable XML document containing conversation, assistant reply, and feedback sections
 */
export const renderMessageContext = (params: RenderMessageContextParams) => {
  const { feedbackMessage, latestAssistantReply, recentMessages } = params;

  // TODO: serialize recent tool calls / tool results into feedback analysis context when we finalize the context format.
  const conversationXml = recentMessages.map(renderMessageElement).join('');
  const latestAssistantReplyXml = latestAssistantReply
    ? renderMessageElement(latestAssistantReply)
    : '';
  const feedbackMessageXml = renderMessageElement(feedbackMessage);

  return [
    '<feedback_analysis_context>',
    `<conversation>${conversationXml}</conversation>`,
    `<latest_assistant_reply>${latestAssistantReplyXml}</latest_assistant_reply>`,
    `<feedback_message>${feedbackMessageXml}</feedback_message>`,
    '</feedback_analysis_context>',
  ].join('');
};
