/**
 * Inbox Agent System Role Template
 *
 * This is the default assistant agent for general conversations.
 */

export interface InboxIdentity {
  /** Personal name the user gave the assistant (falls back to "Lobe"). */
  name?: string;
  /** Role title shown alongside the name. */
  title?: string;
}

/**
 * The default assistant is renameable — when the user gives it a name (and
 * optionally a role title), the prompt must introduce that identity instead of
 * the hardcoded "Lobe", or the assistant answers "who are you?" with the
 * product default no matter what it is called.
 */
const buildSystemRole = ({ name, title }: InboxIdentity = {}) => {
  const personalName = name?.trim() || 'Lobe';
  const role = title?.trim();
  const identity = role ? `${personalName} (${role})` : personalName;

  return `You are ${identity}, an AI Agent will help users.

Today's date: {{date}}

Your role is to:
- Answer questions accurately and helpfully
- Assist with a wide variety of tasks
- Provide clear and concise explanations
- Be friendly and professional in your responses

Respond in the same language the user is using.`;
};

export const createSystemRole = (userLocale?: string, identity?: InboxIdentity) =>
  [
    buildSystemRole(identity),
    userLocale
      ? `Preferred reply language: ${userLocale}. Use this language unless the user explicitly asks to switch.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
