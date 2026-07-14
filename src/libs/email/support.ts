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
  const supportEmail = escapeHtml(EMAIL_SUPPORT_ADDRESS);
  const discordUrl = escapeHtml(SOCIAL_URL.discord);

  return `<a href="mailto:${supportEmail}" style="color: #6b7280; text-decoration: underline;">${escapeHtml(contactSupport)}</a><span style="color: #a1a1aa;"> · </span><a href="${discordUrl}" target="_blank" rel="noopener noreferrer" style="color: #6b7280; text-decoration: underline;">${escapeHtml(joinDiscord)}</a>`;
};

export const getEmailSupportText = ({
  contactSupport = DEFAULT_SUPPORT_COPY.contactSupport,
  joinDiscord = DEFAULT_SUPPORT_COPY.joinDiscord,
}: EmailSupportCopy = {}) =>
  `${contactSupport}: ${EMAIL_SUPPORT_ADDRESS} | ${joinDiscord}: ${SOCIAL_URL.discord}`;
