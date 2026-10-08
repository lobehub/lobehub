import type { AgentHumanRequestItem } from '@lobechat/types';

const describeChannel = (item: AgentHumanRequestItem) =>
  item.action.channel === 'mail' ? 'email' : 'message';

/**
 * The turn the agent sees once its owner answered. Server-written, so the
 * agent can rely on it — and it never carries a secret value: a secret
 * request reports only that the value was provided and where it went.
 */
export const buildOutcomePrompt = (item: AgentHumanRequestItem): string => {
  const what = describeChannel(item);
  const to = item.action.to;
  const ref = `(request ${item.id})`;

  if (item.type === 'secret') {
    const label = item.secret?.label ?? 'secret';
    switch (item.status) {
      case 'completed': {
        return `The user entered the ${label} in the secure input card and your ${what} to ${to} was sent with it ${ref}. The value was delivered without passing through you; you will never see it, so do not ask for it.`;
      }
      case 'declined': {
        return `The user skipped entering the ${label} for your ${what} to ${to} ${ref}. Nothing was sent. Find another way or ask them what they prefer — do not ask them to paste it in chat.`;
      }
      default: {
        return `The ${label} for your ${what} to ${to} could not be delivered: ${item.result?.error ?? item.status} ${ref}. Request a new secure input if it is still needed.`;
      }
    }
  }

  switch (item.status) {
    case 'completed': {
      if (!item.result?.edited) {
        return `The user approved your ${what} to ${to} and it was sent ${ref}.`;
      }
      const subject = item.action.subject ? `\nSubject: ${item.action.subject}` : '';
      return `The user edited your ${what} before approving it; it was sent to ${to} as follows ${ref}.${subject}\n\n${item.action.text}`;
    }
    case 'declined': {
      return `The user discarded your ${what} to ${to} ${ref}. It was not sent; do not send it again unless they ask.`;
    }
    default: {
      return `Your approved ${what} to ${to} failed to send: ${item.result?.error ?? item.status} ${ref}. The user can retry it from the card.`;
    }
  }
};
