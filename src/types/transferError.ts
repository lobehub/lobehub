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
  TargetNoWriteAccess: 'TARGET_NO_WRITE_ACCESS',
  TransferInProgress: 'TRANSFER_IN_PROGRESS',
  TransferNotSupported: 'TRANSFER_NOT_SUPPORTED',
} as const;

export type TransferErrorCode = (typeof TransferErrorCode)[keyof typeof TransferErrorCode];
