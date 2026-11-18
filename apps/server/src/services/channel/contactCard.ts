import type { ContactCard } from '@lobechat/types';

/**
 * The text a contact card message stores as its content. Clients render the card from
 * `metadata.contactCard`; this text is what everything reading only content sees: Agents in the
 * Channel, notifications, bridged bots and search.
 */
export const contactCardText = (card: ContactCard): string => {
  if (card.type === 'user') {
    const { fullName, username } = card.user;
    const name = fullName?.trim() || username || 'Someone';
    return username && name !== username
      ? `[Contact card] ${name} (@${username})`
      : `[Contact card] ${name}`;
  }
  const { owner, title } = card.agent;
  const ownerName = owner.fullName?.trim() || owner.username;
  const name = title?.trim() || 'Agent';
  return ownerName ? `[Agent card] ${name}, by ${ownerName}` : `[Agent card] ${name}`;
};
