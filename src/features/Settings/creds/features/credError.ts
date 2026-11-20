/**
 * Market's 409 reasons, passed through as the tRPC message by
 * `workspaceCreds`: the target slot for this key (the workspace's shared one,
 * or the caller's private one) is taken, or Market does not yet allow private
 * workspace credentials or sharing one credential into several workspaces.
 */
const CONFLICT_KEYS = {
  multi_org_share_disabled: 'creds.errors.multiOrgShareDisabled',
  private_cred_exists: 'creds.errors.privateCredExists',
  private_creds_disabled: 'creds.errors.privateCredsDisabled',
  public_cred_exists: 'creds.errors.publicCredExists',
} as const;

type ConflictKey = (typeof CONFLICT_KEYS)[keyof typeof CONFLICT_KEYS];

/** The `setting` locale key describing a credential write failure, or `fallbackKey`. */
export const credErrorKey = <K extends string>(error: unknown, fallbackKey: K): ConflictKey | K => {
  if (!(error instanceof Error)) return fallbackKey;
  if ((error as { data?: { code?: string } }).data?.code !== 'CONFLICT') return fallbackKey;
  return CONFLICT_KEYS[error.message as keyof typeof CONFLICT_KEYS] ?? fallbackKey;
};
