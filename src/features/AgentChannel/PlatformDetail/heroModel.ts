import type { SetupGuide } from '../quickSetup/guides';

/** Shows enough of an ID to recognise it without printing all of it. */
export const maskId = (id?: string): string => {
  const value = id?.trim() ?? '';
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
};

/** The "invite the bot" link a platform's setup guide knows, once the app ID is known. */
export const findInviteLink = (guide?: SetupGuide): { href: string } | undefined =>
  guide?.steps.find((step) => step.link?.label === 'inviteBot')?.link;
