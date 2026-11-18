/**
 * Address book: people who accepted each other's contact request, and other people's Agents
 * added through their share link. Own Agents are not stored here; clients list them from the
 * Agent list as before.
 */
export const CONTACT_TYPES = ['user', 'agent'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_REQUEST_STATUSES = ['pending', 'accepted', 'declined', 'cancelled'] as const;
export type ContactRequestStatus = (typeof CONTACT_REQUEST_STATUSES)[number];

/** Upper bound for the optional note a person attaches to a contact request. */
export const CONTACT_REQUEST_MESSAGE_MAX_LENGTH = 200;

export interface ContactUserProfile {
  avatar: string | null;
  fullName: string | null;
  id: string;
  username: string | null;
}

export interface ContactAgentProfile {
  agentId: string;
  avatar: string | null;
  backgroundColor: string | null;
  description: string | null;
  owner: ContactUserProfile;
  /** Share id; the visitor page and every run authorize against it. */
  shareId: string;
  /** Custom share handle (`/a/<slug>`), when the owner set one. */
  slug: string | null;
  title: string | null;
}

export interface ContactUserItem {
  createdAt: Date;
  /**
   * Set in a workspace's address book as a member sees it: the person is an external contact
   * of the workspace. `openedToMe` says whether the caller is paired with them and can talk.
   */
  external?: { openedToMe: boolean };
  type: 'user';
  user: ContactUserProfile;
}

export interface ContactAgentItem {
  agent: ContactAgentProfile;
  /**
   * False once the owner pauses the share or trashes the Agent. The contact stays so it can
   * come back when the share resumes; clients show it as unavailable and cannot message it.
   */
  available: boolean;
  createdAt: Date;
  type: 'agent';
}

export type ContactItem = ContactUserItem | ContactAgentItem;

export interface ContactRequestItem {
  createdAt: Date;
  /** `incoming`: sent to me; `outgoing`: sent by me. */
  direction: 'incoming' | 'outgoing';
  id: string;
  message: string | null;
  /** The other person. */
  user: ContactUserProfile;
  /** Set when a member invited the addressee to be an external contact of this workspace. */
  workspace?: ContactRequestWorkspace | null;
}

/** A workspace as the address book names it: an invitation's origin, or one I am external to. */
export interface ContactWorkspace {
  avatar: string | null;
  id: string;
  name: string;
}

export type ContactRequestWorkspace = ContactWorkspace;

/**
 * Relation of a search result or profile to the current user, in the active scope. `member`:
 * a fellow member of the active workspace, reachable without being a contact.
 */
export type ContactRelation =
  'self' | 'contact' | 'member' | 'request_sent' | 'request_received' | 'none';

export type ContactSearchResult =
  | { relation: ContactRelation; type: 'user'; user: ContactUserProfile }
  | { agent: ContactAgentProfile; relation: 'self' | 'contact' | 'none'; type: 'agent' };

/** Owner-side extras of an address book entry; open for later management features. */
export type ContactMetadata = Record<string, unknown>;
