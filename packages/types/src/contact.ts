/**
 * Address book: people who accepted each other's contact request, and other people's Agents
 * added through their share link. Own Agents are not stored here; clients list them from the
 * Agent list as before.
 */
export const CONTACT_TYPES = ['user', 'agent'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_REQUEST_STATUSES = ['pending', 'accepted', 'declined', 'cancelled'] as const;
export type ContactRequestStatus = (typeof CONTACT_REQUEST_STATUSES)[number];

/** Owner-side extras of an address book entry; open for later management features. */
export type ContactMetadata = Record<string, unknown>;
