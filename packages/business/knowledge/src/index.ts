/**
 * Distribution seam: enterprise knowledge bases.
 *
 * An enterprise knowledge base is an ordinary personal-scope knowledge base
 * (`knowledge_bases.workspace_id IS NULL`) owned by one member, which a
 * distribution additionally shares with departments and members at a `view`
 * or `edit` level. The open-source build has no such sharing: every function
 * here reports "not an enterprise knowledge base", so behavior is unchanged.
 *
 * `db` is the request-scoped database handle (or a transaction on it).
 */

export type EnterpriseKbGrantLevel = 'edit' | 'view';
export type EnterpriseKbLevel = EnterpriseKbGrantLevel | 'owner';
export type EnterpriseKbPrincipalType = 'department' | 'user';
export type EnterpriseKbEventAction = 'access_updated' | 'created' | 'deleted' | 'transferred';

export type EnterpriseKbErrorCode =
  'INVALID_PRINCIPAL' | 'NOT_ENABLED' | 'NOT_ENTERPRISE' | 'STALE_VERSION';

export class EnterpriseKbError extends Error {
  code: EnterpriseKbErrorCode;

  constructor(code: EnterpriseKbErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'EnterpriseKbError';
    this.code = code;
  }
}

/** Who performed a change: a back-office administrator or a front-end member. */
export interface EnterpriseKbActor {
  id: string;
  kind: 'admin' | 'member';
  name: string;
}

export interface EnterpriseKbAccess {
  knowledgeBaseId: string;
  level: EnterpriseKbLevel;
  /** `knowledge_bases.user_id` — every row inside the knowledge base carries this user id. */
  ownerId: string;
}

export type EnterpriseKbAccessResolution =
  | { enterprise: false }
  /** `access: null` — an enterprise knowledge base the user may not see. */
  | { access: EnterpriseKbAccess | null; enterprise: true };

export interface EnterpriseKbGrantInput {
  accessLevel: EnterpriseKbGrantLevel;
  principalId: string;
  principalType: EnterpriseKbPrincipalType;
}

export interface EnterpriseKbGrant extends EnterpriseKbGrantInput {
  /** The department or member no longer exists. */
  deleted: boolean;
  /** For a member: the name of their department, when they have one. */
  departmentName?: string | null;
  /** Members covered, sub-departments included; `null` for a member or a deleted principal. */
  memberCount: number | null;
  name: string;
}

export interface EnterpriseKbAccessState {
  grants: EnterpriseKbGrant[];
  version: number;
}

export interface EnterpriseKbEstimate {
  /** Members that would move from `edit` to `view`. */
  downgraded: number;
  edit: number;
  /** Members that have access today and would have none. */
  lost: number;
  /** Distinct members with access, the owner excluded. */
  total: number;
  view: number;
}

export interface EnterpriseKbAccessSummary {
  departmentCount: number;
  /** Granted to the root department, i.e. to every member. */
  everyone: boolean;
  userCount: number;
}

export interface EnterpriseKbDirectory {
  departments: { id: string; memberCount: number; name: string; parentId: string | null }[];
  users: { departmentName: string | null; email: string | null; id: string; name: string }[];
}

export interface EnterpriseKbMember {
  departmentName: string | null;
  disabled: boolean;
  email: string | null;
  id: string;
  name: string;
}

export interface EnterpriseKbEvent {
  action: EnterpriseKbEventAction;
  actor: EnterpriseKbActor;
  /** ISO 8601. */
  createdAt: string;
  detail: Record<string, unknown>;
  id: string;
}

const disabled = (): never => {
  throw new EnterpriseKbError('NOT_ENABLED');
};

export const isEnterpriseKnowledgeEnabled = (): boolean => false;

export const resolveEnterpriseKbAccess = async (
  _db: unknown,
  _userId: string,
  _knowledgeBaseId: string,
): Promise<EnterpriseKbAccessResolution> => ({ enterprise: false });

/** Every enterprise knowledge base the user can see, own ones included. */
export const listAccessibleEnterpriseKbs = async (
  _db: unknown,
  _userId: string,
): Promise<EnterpriseKbAccess[]> => [];

/** The enterprise ones among `knowledgeBaseIds`; all of them when the list is omitted. */
export const listEnterpriseKbIds = async (
  _db: unknown,
  _knowledgeBaseIds?: string[],
): Promise<string[]> => [];

export const markEnterpriseKb = async (
  _db: unknown,
  _params: { actor: EnterpriseKbActor; knowledgeBaseId: string; name: string },
): Promise<void> => disabled();

/** Drops the grants and uploader records; the change log is kept. */
export const unmarkEnterpriseKb = async (
  _db: unknown,
  _params: { actor: EnterpriseKbActor; knowledgeBaseId: string; name: string },
): Promise<void> => disabled();

export const getEnterpriseKbAccessState = async (
  _db: unknown,
  _knowledgeBaseId: string,
): Promise<EnterpriseKbAccessState> => disabled();

/** Replaces the whole grant list. Throws `STALE_VERSION` when `version` is not the stored one. */
export const updateEnterpriseKbAccess = async (
  _db: unknown,
  _params: {
    actor: EnterpriseKbActor;
    grants: EnterpriseKbGrantInput[];
    knowledgeBaseId: string;
    version: number;
  },
): Promise<EnterpriseKbAccessState> => disabled();

/** What `grants` would mean, compared with the stored list. Writes nothing. */
export const estimateEnterpriseKbAccess = async (
  _db: unknown,
  _params: { grants: EnterpriseKbGrantInput[]; knowledgeBaseId: string },
): Promise<EnterpriseKbEstimate> => disabled();

export const summarizeEnterpriseKbAccess = async (
  _db: unknown,
  _knowledgeBaseIds: string[],
): Promise<Record<string, EnterpriseKbAccessSummary>> => ({});

/** All departments; `users` is filled only when `keyword` is given (at most 20). */
export const getEnterpriseKbDirectory = async (
  _db: unknown,
  _params: { keyword?: string },
): Promise<EnterpriseKbDirectory> => disabled();

export const searchEnterpriseKbMembers = async (
  _db: unknown,
  _params: { keyword: string; limit?: number },
): Promise<EnterpriseKbMember[]> => disabled();

export const findEnterpriseKbMember = async (
  _db: unknown,
  _by: { email: string } | { id: string },
): Promise<EnterpriseKbMember | null> => disabled();

/**
 * Bookkeeping for an ownership transfer; the caller moves the rows themselves.
 * Removes the new owner's own grant, optionally grants the previous owner `edit`,
 * bumps the version and records the event.
 */
export const recordEnterpriseKbTransfer = async (
  _db: unknown,
  _params: {
    actor: EnterpriseKbActor;
    fileCount: number;
    fromUserId: string;
    keepPreviousOwnerEdit: boolean;
    knowledgeBaseId: string;
    toUserId: string;
  },
): Promise<void> => disabled();

/** Newest first. */
export const listEnterpriseKbEvents = async (
  _db: unknown,
  _params: { knowledgeBaseId: string; limit?: number },
): Promise<EnterpriseKbEvent[]> => disabled();

/** Remembers who uploaded or created an item (file id or document id). */
export const recordEnterpriseKbItemUploaders = async (
  _db: unknown,
  _items: { actor: EnterpriseKbActor; itemId: string; knowledgeBaseId: string }[],
): Promise<void> => {};

export const getEnterpriseKbItemUploaders = async (
  _db: unknown,
  _itemIds: string[],
): Promise<Record<string, EnterpriseKbActor>> => ({});

export const removeEnterpriseKbItemUploaders = async (
  _db: unknown,
  _itemIds: string[],
): Promise<void> => {};
