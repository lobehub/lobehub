import { GMAIL_EMAIL_MAX_LENGTH, GMAIL_EMAIL_SOURCE_MAX_LENGTH } from './constants';

export const clipGmailText = (value: string | undefined, limit: number) => {
  if (!value) return undefined;
  const overflowed = value.length > limit;
  const clean = value.slice(0, limit).replaceAll('\u0000', '').trim();
  if (!clean || !overflowed) return clean;
  return `${clean.trimEnd()}...`;
};

export const extractGmailEmail = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const bounded = value.slice(0, GMAIL_EMAIL_SOURCE_MAX_LENGTH);
  const match = bounded.match(/<([^>]+)>/);
  return (match?.[1] ?? bounded).toLowerCase().trim().slice(0, GMAIL_EMAIL_MAX_LENGTH) || undefined;
};
