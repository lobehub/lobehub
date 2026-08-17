export const TransferErrorCode = {
  /**
   * The agent belongs to a chat group (it is the group's supervisor, or a
   * member the group itself built) and has no life outside it. The error data
   * carries the groups so the surface can name them.
   */
  AgentOwnedByGroup: 'AGENT_OWNED_BY_GROUP',
  CopyInProgress: 'COPY_IN_PROGRESS',
  /**
   * The group references a member agent the caller cannot see. Moving the
   * group would clone that agent into a scope they can read, so it is refused
   * — without naming the member, since that is the part being withheld.
   */
  GroupHasInaccessibleMember: 'GROUP_HAS_INACCESSIBLE_MEMBER',
  FileStorageLimitExceeded: 'FILE_STORAGE_LIMIT_EXCEEDED',
  NoPermission: 'NO_PERMISSION',
  OwnerOnly: 'OWNER_ONLY',
  ResourceNotFound: 'RESOURCE_NOT_FOUND',
  SameWorkspace: 'SAME_WORKSPACE',
  /** Member transfer: the picked recipient already owns the resource (or is the initiator). */
  TargetIsCurrentOwner: 'TARGET_IS_CURRENT_OWNER',
  TargetNoWriteAccess: 'TARGET_NO_WRITE_ACCESS',
  /** Member transfer: the picked recipient is not an active member of the workspace. */
  TargetNotWorkspaceMember: 'TARGET_NOT_WORKSPACE_MEMBER',
  TransferInProgress: 'TRANSFER_IN_PROGRESS',
  TransferNotSupported: 'TRANSFER_NOT_SUPPORTED',
  /** Member transfer: the resource already carries a live transfer request. */
  TransferRequestPending: 'TRANSFER_REQUEST_PENDING',
  /** Member transfer: the request outlived its `expiresAt` before the click landed. */
  TransferRequestExpired: 'TRANSFER_REQUEST_EXPIRED',
  /** Member transfer accept: the owner changed (or the resource left the workspace) since the request. */
  TransferRequestStale: 'TRANSFER_REQUEST_STALE',
} as const;

export type TransferErrorCode = (typeof TransferErrorCode)[keyof typeof TransferErrorCode];
