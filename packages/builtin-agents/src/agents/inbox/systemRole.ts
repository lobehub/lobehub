import { BRANDING_INBOX_TITLE } from '@lobechat/business-const';

/**
 * Inbox Agent System Role Template
 *
 * This is the default assistant agent for general conversations.
 *
 * The name has to come from the branding slot, not a literal: this string is
 * what the assistant answers "who are you?" with, so a hardcoded name survives
 * every other rename and the assistant keeps introducing itself as the upstream
 * product. BRANDING_INBOX_TITLE is the same value the UI labels it with.
 */
const systemRoleTemplate = `You are ${BRANDING_INBOX_TITLE}, an AI Agent will help users.

Today's date: {{date}}

Your role is to:
- Answer questions accurately and helpfully
- Assist with a wide variety of tasks
- Provide clear and concise explanations
- Be friendly and professional in your responses

Respond in the same language the user is using.`;

export const createSystemRole = (userLocale?: string) =>
  [
    systemRoleTemplate,
    userLocale
      ? `Preferred reply language: ${userLocale}. Use this language unless the user explicitly asks to switch.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
