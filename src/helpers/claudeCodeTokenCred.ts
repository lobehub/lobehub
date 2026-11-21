import { type UserCredSummary } from '@lobechat/types';

/**
 * Fixed vault key of the Claude Code OAuth token. The cloud sandbox injects the
 * credential stored under this key; it never reads an agent-level reference.
 */
export const CLAUDE_CODE_TOKEN_CRED_KEY = 'CLAUDE_CODE_OAUTH_TOKEN';

/** A credential as `market.creds.listForContext` returns it. */
export interface ContextCredSummary {
  key: string;
  name: string;
  ownerDisplayName?: string;
  ownerType?: 'organization' | 'user';
}

export type ClaudeCodeTokenStatus =
  /**
   * `editable`: the token the run reads is the caller's own personal credential.
   * Saving only writes that credential, so a workspace- or other-member-owned
   * token can't be changed from here.
   */
  | { display: string; editable: boolean; status: 'configured' }
  /** The caller owns a token, but runs in the active workspace can't read it. */
  | { personalCred: UserCredSummary; status: 'personalNotShared' }
  | { status: 'missing' }
  /** The credential lookup failed; whether the run can read a token is unknown. */
  | { status: 'unknown' };

interface ResolveClaudeCodeTokenStatusParams {
  /** `market.creds.listForContext`: the credentials a run in this scope reads. */
  contextCreds: ContextCredSummary[];
  inWorkspace: boolean;
  /** `market.creds.list`: the caller's personal vault. */
  personalCreds: UserCredSummary[];
}

/**
 * Whether a cloud run of a Claude Code agent will find its OAuth token. The
 * runtime resolves credentials in the run's scope (the workspace's
 * organization view inside a workspace, the personal vault otherwise), so the
 * caller's personal vault alone can't answer this.
 */
export const resolveClaudeCodeTokenStatus = ({
  contextCreds,
  inWorkspace,
  personalCreds,
}: ResolveClaudeCodeTokenStatusParams): ClaudeCodeTokenStatus => {
  const contextCred = contextCreds.find((c) => c.key === CLAUDE_CODE_TOKEN_CRED_KEY);
  const personalCred = personalCreds.find((c) => c.key === CLAUDE_CODE_TOKEN_CRED_KEY);

  if (contextCred) {
    // Only show the personal masked preview when that personal credential is
    // the one the run reads; otherwise it belongs to another owner.
    const isOwnCred = !inWorkspace || !!personalCred?.sharedToActiveWorkspace;
    const preview = isOwnCred ? personalCred?.maskedPreview : undefined;

    return {
      display: preview ?? contextCred.name,
      editable: isOwnCred && !!personalCred,
      status: 'configured',
    };
  }

  if (personalCred) {
    return { personalCred, status: 'personalNotShared' };
  }

  return { status: 'missing' };
};

/**
 * Whether the caller can remove the token from the agent settings. Only the
 * caller's own personal credential can be deleted here; a workspace- or
 * other-member-owned token is managed in Credentials.
 */
export const canRemoveClaudeCodeToken = (status: ClaudeCodeTokenStatus): boolean =>
  status.status === 'personalNotShared' || (status.status === 'configured' && status.editable);
