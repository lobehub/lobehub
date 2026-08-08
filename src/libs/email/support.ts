import { BRANDING_EMAIL, SOCIAL_URL } from '@lobechat/business-const';

interface EmailSupportCopy {
  contactSupport?: string;
  joinDiscord?: string;
}

const DEFAULT_SUPPORT_COPY = {
  contactSupport: 'Contact support',
  joinDiscord: 'Join Discord',
} satisfies Required<EmailSupportCopy>;

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const EMAIL_SUPPORT_ADDRESS = BRANDING_EMAIL.support;
export const EMAIL_SUPPORT_REPLY_TO = BRANDING_EMAIL.replyTo;

export const getEmailSupportHtml = ({
  contactSupport = DEFAULT_SUPPORT_COPY.contactSupport,
  joinDiscord = DEFAULT_SUPPORT_COPY.joinDiscord,
}: EmailSupportCopy = {}) => {
  const supportEmail = EMAIL_SUPPORT_ADDRESS?.trim();
  const discordUrl = SOCIAL_URL.discord?.trim();
  const parts: string[] = [];

  if (supportEmail) {
    parts.push(
      `<a href="mailto:${escapeHtml(supportEmail)}" style="color: #6b7280; text-decoration: underline;">${escapeHtml(contactSupport)}</a>`,
    );
  }

  if (discordUrl) {
    parts.push(
      `<a href="${escapeHtml(discordUrl)}" target="_blank" rel="noopener noreferrer" style="color: #6b7280; text-decoration: underline;">${escapeHtml(joinDiscord)}</a>`,
    );
  }

  return parts.join('<span style="color: #a1a1aa;"> · </span>');
};

export const getEmailSupportText = ({
  contactSupport = DEFAULT_SUPPORT_COPY.contactSupport,
  joinDiscord = DEFAULT_SUPPORT_COPY.joinDiscord,
}: EmailSupportCopy = {}) => {
  const supportEmail = EMAIL_SUPPORT_ADDRESS?.trim();
  const discordUrl = SOCIAL_URL.discord?.trim();
  const parts: string[] = [];

  if (supportEmail) {
    parts.push(`${contactSupport}: ${supportEmail}`);
  }

  if (discordUrl) {
    parts.push(`${joinDiscord}: ${discordUrl}`);
  }

  return parts.join(' | ');
};
