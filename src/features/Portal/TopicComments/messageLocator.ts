interface LocatableMessage {
  id: string;
  tasks?: Array<{ id: string }>;
  threadId?: string | null;
}

const MESSAGE_HIGHLIGHT_ATTRIBUTE = 'data-message-locate-highlight';
const MESSAGE_HIGHLIGHT_DURATION_MS = 1400;
const MESSAGE_HIGHLIGHT_MAX_FRAMES = 240;
const MESSAGE_HIGHLIGHT_POSITION_EPSILON = 0.5;
const MESSAGE_HIGHLIGHT_SETTLE_MS = 150;
let messageHighlightSequence = 0;

/** The message FK is SET NULL on deletion; absence from the currently loaded list is not deletion. */
export const isTopicCommentAnchorDeleted = (messageId: string | null) => messageId === null;

export const resolveTopicCommentMessageLocation = (
  messages: LocatableMessage[],
  messageId: string | null,
) => {
  if (!messageId) return;

  const index = messages.findIndex(
    ({ id, tasks }) => id === messageId || tasks?.some((task) => task.id === messageId),
  );

  if (index < 0) return;
  return { elementId: messages[index].id, index };
};

export const highlightMessageWhenScrollSettles = (messageId: string) => {
  const sequence = ++messageHighlightSequence;
  let remainingFrames = MESSAGE_HIGHLIGHT_MAX_FRAMES;
  let lastMessageElement: HTMLElement | undefined;
  let lastTop: number | undefined;
  let stableSince: number | undefined;

  document
    .querySelectorAll<HTMLElement>(`[${MESSAGE_HIGHLIGHT_ATTRIBUTE}]`)
    .forEach((element) => element.removeAttribute(MESSAGE_HIGHLIGHT_ATTRIBUTE));

  const waitForScrollEnd = (timestamp: number) => {
    if (sequence !== messageHighlightSequence) return;

    const messageElement = Array.from(
      document.querySelectorAll<HTMLElement>('[data-message-id]'),
    ).find((element) => element.dataset.messageId === messageId);

    if (!messageElement) {
      if (remainingFrames-- > 0) requestAnimationFrame(waitForScrollEnd);
      return;
    }

    const top = messageElement.getBoundingClientRect().top;
    if (messageElement !== lastMessageElement || lastTop === undefined) {
      lastMessageElement = messageElement;
      stableSince = undefined;
    } else if (Math.abs(top - lastTop) <= MESSAGE_HIGHLIGHT_POSITION_EPSILON) {
      stableSince ??= timestamp;
    } else {
      stableSince = undefined;
    }
    lastTop = top;

    const hasSettled =
      stableSince !== undefined && timestamp - stableSince >= MESSAGE_HIGHLIGHT_SETTLE_MS;
    if (!hasSettled) {
      if (remainingFrames-- > 0) requestAnimationFrame(waitForScrollEnd);
      return;
    }

    const sequenceValue = String(sequence);
    messageElement.removeAttribute(MESSAGE_HIGHLIGHT_ATTRIBUTE);
    void messageElement.offsetWidth;
    messageElement.setAttribute(MESSAGE_HIGHLIGHT_ATTRIBUTE, sequenceValue);

    window.setTimeout(() => {
      if (messageElement.getAttribute(MESSAGE_HIGHLIGHT_ATTRIBUTE) === sequenceValue) {
        messageElement.removeAttribute(MESSAGE_HIGHLIGHT_ATTRIBUTE);
      }
    }, MESSAGE_HIGHLIGHT_DURATION_MS);
  };

  requestAnimationFrame(waitForScrollEnd);
};
