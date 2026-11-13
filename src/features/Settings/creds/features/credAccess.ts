import { type UserCredSummary } from '@lobechat/types';

/**
 * What the signed-in member may do with a row of a workspace credential list
 * (`workspaceCreds.list`). Plain functions so the rules have direct unit
 * coverage — see `credAccess.test.ts`.
 *
 * A row is one of:
 * - a workspace credential (`ownerType: 'organization'`), shared with every
 *   member (`visibility: 'public'`) or private to the member who created it;
 * - the member's own personal credential shared into the workspace
 *   (`ownerType: 'user'`, `ownerAccountId` is theirs);
 * - another member's published personal credential.
 *
 * Market enforces the same rules; these only decide which actions to offer.
 */
type CredRow = Pick<
  UserCredSummary,
  'createdByAccountId' | 'ownerAccountId' | 'ownerType' | 'visibility'
>;

export interface CredRowViewer {
  /** Holds the workspace's credential-management permission. */
  isAdmin: boolean;
  /** The member's Market account id. */
  myAccountId: number | undefined;
}

export interface CredRowAccess {
  /** Make it private to its creator / owner again. */
  makePrivate: boolean;
  /** Edit, view and delete the credential itself. */
  manage: boolean;
  /** Publish it to every member. */
  publish: boolean;
  /** Remove a shared personal credential from the workspace. */
  unshare: boolean;
}

const NONE: CredRowAccess = { makePrivate: false, manage: false, publish: false, unshare: false };

export const isOwnCredRow = (cred: CredRow, myAccountId: number | undefined): boolean =>
  cred.ownerType === 'user' && myAccountId !== undefined && cred.ownerAccountId === myAccountId;

export const workspaceCredRowAccess = (cred: CredRow, viewer: CredRowViewer): CredRowAccess => {
  const isPublic = cred.visibility === 'public';

  if (cred.ownerType === 'user') {
    // A personal credential is edited where it lives, on the owner's personal
    // page; here its owner only decides how it is shared, and an admin may
    // take it out of the workspace.
    if (!isOwnCredRow(cred, viewer.myAccountId)) return { ...NONE, unshare: viewer.isAdmin };
    return { makePrivate: isPublic, manage: false, publish: !isPublic, unshare: true };
  }

  // Visibility is the creator's call alone, as with a device: an admin making
  // someone's credential private would move it into that member's private list.
  const isCreator =
    viewer.myAccountId !== undefined && cred.createdByAccountId === viewer.myAccountId;
  return {
    makePrivate: isCreator && isPublic,
    manage: isCreator || viewer.isAdmin,
    publish: isCreator && !isPublic,
    unshare: false,
  };
};
